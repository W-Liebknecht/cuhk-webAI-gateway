"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { cuhkProvider } = require("../gateway/cuhk-provider/src/ccr-registration.cjs");
const { ensureConfig, primaryCheckout } = require("./bridge-paths.cjs");

const root = path.resolve(__dirname, "..");
const state = path.join(root, "gateway/runtime-state");
const controlPath = path.join(state, "control.json");
const lockPath = path.join(state, "gateway.lock");
const LEGACY_PORTS = Object.freeze({ management: 3459, gateway: 3460, core: 3461, backend: 3462 });

function normalizeControl(control) {
  if (!control || typeof control !== "object") return null;
  const ports = { ...LEGACY_PORTS, ...(control.ports || {}) };
  if (!control.webToken || !control.gatewayKey || !Number.isInteger(control.pid)
      || Object.values(ports).some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) return null;
  return { ...control, ports };
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function readControl() { return normalizeControl(readJson(controlPath)); }

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, filePath);
}

function removeFile(filePath) { try { fs.unlinkSync(filePath); } catch (error) { if (error.code !== "ENOENT") throw error; } }

function resolveCcrRoot(projectRoot = root, environment = process.env) {
  const candidates = [];
  if (environment.CUHK_CCR_ROOT) candidates.push(path.resolve(environment.CUHK_CCR_ROOT));
  candidates.push(path.join(projectRoot, "research/claude-code-router"));

  const dotGit = path.join(projectRoot, ".git");
  try {
    if (fs.statSync(dotGit).isFile()) {
      const match = /^gitdir:\s*(.+)$/im.exec(fs.readFileSync(dotGit, "utf8"));
      if (match) {
        const gitDirectory = path.resolve(projectRoot, match[1].trim());
        const commonDirectory = path.resolve(gitDirectory, fs.readFileSync(path.join(gitDirectory, "commondir"), "utf8").trim());
        candidates.push(path.join(path.dirname(commonDirectory), "research/claude-code-router"));
      }
    }
  } catch {}

  const unique = [...new Set(candidates)];
  unique.push(path.join(primaryCheckout(projectRoot), ".dependencies/claude-code-router"));
  const found = unique.find((candidate) => fs.existsSync(path.join(candidate, "packages/core/dist/main/server.js")));
  if (found) return found;
  throw new Error(`CCR runtime was not found. Checked: ${unique.join(", ")}`);
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function allocateLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function allocatePorts() {
  const values = [];
  while (values.length < 4) {
    const port = await allocateLoopbackPort();
    if (!values.includes(port)) values.push(port);
  }
  return { management: values[0], gateway: values[1], core: values[2], backend: values[3] };
}

async function rpc(control, method, ...args) {
  const normalized = normalizeControl(control);
  if (!normalized) throw new Error("Gateway control state is invalid.");
  const response = await fetch(`http://127.0.0.1:${normalized.ports.management}/api/ccr/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ccr-web-auth": normalized.webToken },
    body: JSON.stringify({ method, args }),
    signal: AbortSignal.timeout(5000)
  });
  const json = await response.json();
  if (!json.ok) throw new Error(json.error?.message || `RPC ${method} failed`);
  return json.value;
}

async function currentStatus(control = readControl()) {
  if (!control) return { running: false };
  try {
    const gateway = await rpc(control, "getGatewayStatus");
    let readiness = null;
    try {
      const response = await fetch(`http://127.0.0.1:${control.ports.gateway}/plugins/cuhk/health/ready`, { signal: AbortSignal.timeout(3000) });
      readiness = await response.json();
    } catch {}
    return { running: gateway.state === "running", gateway: gateway.state, readiness, ports: control.ports };
  } catch {
    return { running: false, stale: true, ports: control.ports };
  }
}

function acquireStartupLock(instanceId) {
  fs.mkdirSync(state, { recursive: true });
  const lock = readJson(lockPath);
  if (lock) {
    const recent = Date.now() - Number(lock.createdAt || 0) < 120000;
    if (lock.role === "starting" && recent && processExists(lock.launcherPid)) {
      throw new Error("Another CUHK Gateway start is already in progress.");
    }
    removeFile(lockPath);
  }
  fs.writeFileSync(lockPath, JSON.stringify({ role: "starting", instanceId, launcherPid: process.pid, createdAt: Date.now() }, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
}

async function start() {
  ensureConfig(root);
  const existing = readControl();
  const existingStatus = await currentStatus(existing);
  if (existingStatus.running) {
    console.log(JSON.stringify({ ok: true, alreadyRunning: true, ...existingStatus }, null, 2));
    return;
  }
  const ccr = resolveCcrRoot();
  const instanceId = crypto.randomUUID();
  acquireStartupLock(instanceId);
  await cleanupProcesses();
  if (fs.existsSync(controlPath)) removeFile(controlPath);
  const ports = await allocatePorts();
  const webToken = crypto.randomBytes(32).toString("hex");
  const gatewayKey = crypto.randomBytes(32).toString("hex");
  const stdout = fs.openSync(path.join(state, "gateway.log"), "a");
  const stderr = fs.openSync(path.join(state, "gateway-error.log"), "a");
  const host = spawn(process.execPath, [path.join(ccr, "packages/core/dist/main/server.js"), "--host", "127.0.0.1", "--port", String(ports.management), "--no-gateway"], {
    cwd: ccr,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", stdout, stderr],
    env: {
      ...process.env,
      CUHK_PROCESS_DIRECTORY: path.join(state, "processes"),
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require ${JSON.stringify(path.join(root, "bin/process-owner.cjs"))}`,
      CCR_WEB_AUTH_TOKEN: webToken,
      CCR_INTERNAL_HOME_DIR: path.join(state, "home"),
      CCR_INTERNAL_APP_DATA_DIR: path.join(state, "appdata"),
      CCR_INTERNAL_USER_DATA_DIR: path.join(state, "data")
    }
  });
  host.unref();
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  const control = { version: 2, instanceId, pid: host.pid, startedAt: new Date().toISOString(), webToken, gatewayKey, ports };

  try {
    let config;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try { config = await rpc(control, "getConfig"); break; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
    }
    assert.ok(config, "CCR management host did not start");
    config.HOST = config.gateway.host = config.gateway.coreHost = "127.0.0.1";
    config.PORT = config.gateway.port = ports.gateway;
    config.gateway.corePort = ports.core;
    config.APIKEY = gatewayKey;
    config.API_TIMEOUT_MS = 3600000;
    config.profile.enabled = false;
    config.profile.profiles = [];
    config.Providers = [cuhkProvider(ports.backend)];
    const onlineDiagnosticPath = process.env.CUHK_ONLINE_DIAGNOSTIC_PATH
      ? path.resolve(process.env.CUHK_ONLINE_DIAGNOSTIC_PATH)
      : undefined;
    config.plugins = [{
      id: "cuhk-ai-provider",
      enabled: true,
      module: path.join(root, "gateway/cuhk-provider/index.cjs"),
      surfaces: { apps: false, gateway: true, provider: false },
      permissions: ["trusted-code", "gateway-routes", "http-backends"],
      config: {
        backendPort: ports.backend,
        configPath: path.join(root, "config.json"),
        ...(onlineDiagnosticPath ? { diagnosticPath: onlineDiagnosticPath } : {})
      }
    }];
    await rpc(control, "saveConfig", config, { applyProfile: false });
    const saved = await rpc(control, "getConfig");
    assert.ok(saved.APIKEY, "CCR did not expose a local gateway API key");
    control.gatewayKey = saved.APIKEY;
    await rpc(control, "startGateway");
    const gateway = await rpc(control, "getGatewayStatus");
    assert.equal(gateway.state, "running", JSON.stringify(gateway));
    writeJsonAtomic(controlPath, control);
    removeFile(lockPath);
    writeJsonAtomic(lockPath, { role: "running", instanceId, pid: host.pid, createdAt: Date.now(), ports });
    console.log(JSON.stringify({ ok: true, started: true, ...(await currentStatus(control)) }, null, 2));
  } catch (error) {
    await cleanupProcesses();
    removeFile(controlPath);
    removeFile(lockPath);
    throw error;
  }
}

async function stop() {
  // Clean the full tree before deleting state, even when RPC/state is broken.
  await cleanupProcesses();
  removeFile(controlPath);
  removeFile(lockPath);
  console.log(JSON.stringify({ ok: true, stopped: true }, null, 2));
}

async function cleanupProcesses() {
  if (process.platform !== "win32") {
    const control = readControl();
    if (control && processExists(control.pid)) process.kill(control.pid);
    return;
  }
  const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", path.join(root, "bin/cleanup-processes.ps1"), "-ExcludePid", String(process.pid)],
  { windowsHide: true, timeout: 45000 });
  const result = JSON.parse(stdout.trim());
  if (!result.ok || result.remaining !== 0) throw new Error("Related CUHK processes remain after cleanup.");
  return result;
}

async function main(command = process.argv[2] || "status") {
  if (command === "start") return start();
  if (command === "stop") return stop();
  if (command === "restart") { await stop(); return start(); }
  if (command === "status") {
    console.log(JSON.stringify({ ok: true, ...(await currentStatus()) }, null, 2));
    return;
  }
  throw new Error("Usage: node bin/cuhk-gateway.cjs start|stop|restart|status");
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { LEGACY_PORTS, allocatePorts, currentStatus, normalizeControl, processExists, readControl, resolveCcrRoot, rpc, start, stop, writeJsonAtomic };
