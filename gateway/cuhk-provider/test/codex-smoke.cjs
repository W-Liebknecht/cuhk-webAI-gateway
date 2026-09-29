"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { cuhkProvider } = require("../src/ccr-registration.cjs");

const root = path.resolve(__dirname, "../../..");
const ccr = path.join(root, "research/claude-code-router");
const state = path.join(root, "gateway/host-state");
const codexHome = path.join(state, "codex-home");
const workspace = path.join(state, "codex-workspace");
const token = crypto.randomBytes(24).toString("hex");
const api = "http://127.0.0.1:3459/api/ccr/rpc";
const codexPath = process.env.CODEX_CLI_PATH || "codex";
const mode = process.argv.find((value) => ["text", "shell", "patch"].includes(value)) || "text";
const diagnostics = path.join(state, `codex-${mode}-gateway.ndjson`);
let hostLogs = "";

async function rpc(method, ...args) {
  const response = await fetch(api, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ccr-web-auth": token },
    body: JSON.stringify({ method, args })
  });
  const json = await response.json();
  if (!json.ok) throw new Error(json.error?.message || `RPC ${method} failed`);
  return json.value;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += chunk; process.stderr.write(chunk); });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function prepareCodexHome() {
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  if (fs.existsSync(diagnostics)) fs.rmSync(diagnostics);
  const config = [
    'model = "gpt-5.6-sol"',
    'model_provider = "cuhk_gateway"',
    'model_reasoning_effort = "medium"',
    'model_context_window = 32768',
    'disable_response_storage = true',
    '',
    '[model_providers.cuhk_gateway]',
    'name = "CUHK Gateway"',
    'base_url = "http://127.0.0.1:3458/v1"',
    'env_key = "CUHK_GATEWAY_KEY"',
    'wire_api = "responses"',
    'request_max_retries = 0',
    'stream_max_retries = 0',
    'stream_idle_timeout_ms = 300000',
    '',
    '[features]',
    'multi_agent = false',
    'apps = false',
    'browser_use = false',
    'computer_use = false',
    'image_generation = false',
    '',
    '[windows]',
    'sandbox = "elevated"',
    ''
  ].join("\n");
  fs.writeFileSync(path.join(codexHome, "config.toml"), config, "utf8");
  if (mode === "patch") {
    const marker = path.join(workspace, "mvp-marker.txt");
    if (fs.existsSync(marker)) fs.rmSync(marker);
  }
}

function promptForMode() {
  if (mode === "shell") {
    return "Use the shell tool exactly once to run a command that prints CUHK_CODEX_SHELL_OK, then reply with exactly CUHK_CODEX_SHELL_OK.";
  }
  if (mode === "patch") {
    return "Use apply_patch exactly once to create mvp-marker.txt in the current directory with exactly one line: CUHK_CODEX_PATCH_OK. Then reply with exactly CUHK_CODEX_PATCH_OK.";
  }
  return "Do not use any tool. Reply with exactly CUHK_CODEX_TEXT_OK.";
}

async function main() {
  prepareCodexHome();
  const captureProxy = http.createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      let parsedBody;
      try { parsedBody = JSON.parse(body.toString("utf8")); } catch (error) { parsedBody = { parseError: error.message, bytes: body.length, prefix: body.subarray(0, 64).toString("hex") }; }
      fs.appendFileSync(diagnostics, JSON.stringify({
        type: "client_request",
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(Object.entries(request.headers).filter(([name]) => name !== "authorization")),
        body: parsedBody
      }) + "\n", "utf8");
      const upstream = await fetch(`http://127.0.0.1:3460${request.url}`, {
        method: request.method,
        headers: request.headers,
        body
      });
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      fs.appendFileSync(diagnostics, JSON.stringify({ type: "capture_proxy_error", message: error.message }) + "\n", "utf8");
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  await new Promise((resolve, reject) => {
    captureProxy.once("error", reject);
    captureProxy.listen(3458, "127.0.0.1", resolve);
  });
  const host = spawn(process.execPath, [path.join(ccr, "packages/core/dist/main/server.js"), "--host", "127.0.0.1", "--port", "3459", "--no-gateway"], {
    cwd: ccr,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      CCR_WEB_AUTH_TOKEN: token,
      CCR_INTERNAL_HOME_DIR: path.join(state, "home"),
      CCR_INTERNAL_APP_DATA_DIR: path.join(state, "appdata"),
      CCR_INTERNAL_USER_DATA_DIR: path.join(state, "data")
    }
  });
  host.stdout.on("data", (chunk) => { hostLogs += chunk; });
  host.stderr.on("data", (chunk) => { hostLogs += chunk; });
  try {
    let config;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        config = await rpc("getConfig");
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    assert.ok(config, "CCR management host did not start");
    config.HOST = config.gateway.host = config.gateway.coreHost = "127.0.0.1";
    config.PORT = config.gateway.port = 3460;
    config.gateway.corePort = 3461;
    config.APIKEY = token;
    config.profile.enabled = false;
    config.profile.profiles = [];
    config.observability.requestLogs = true;
    config.observability.requestLogBodyCapture = "all";
    config.observability.requestLogSuccessSampleRate = 1;
    config.Providers = [cuhkProvider()];
    config.plugins = [{
      id: "cuhk-ai-provider",
      enabled: true,
      module: path.join(root, "gateway/cuhk-provider/index.cjs"),
      surfaces: { apps: false, gateway: true, provider: false },
      permissions: ["trusted-code", "gateway-routes", "http-backends"],
      config: {
        backendPort: 3462,
        configPath: path.join(__dirname, "smoke-config.json"),
        diagnosticPath: diagnostics
      }
    }];
    await rpc("saveConfig", config, { applyProfile: false });
    const saved = await rpc("getConfig");
    assert.ok(saved.APIKEY, "CCR did not expose a local gateway API key");
    await rpc("startGateway");
    const gateway = await rpc("getGatewayStatus");
    assert.equal(gateway.state, "running", JSON.stringify(gateway));

    const result = await run(codexPath, [
      "exec",
      "--json",
      "--ephemeral",
      "--skip-git-repo-check",
      "--sandbox", "workspace-write",
      "-c", 'approval_policy="never"',
      "-C", workspace,
      promptForMode()
    ], {
      cwd: workspace,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        CUHK_GATEWAY_KEY: saved.APIKEY,
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost"
      }
    });

    const events = result.stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    const agentText = events
      .filter((event) => event.type === "item.completed" && event.item?.type === "agent_message")
      .map((event) => event.item.text || "")
      .join("\n")
      .replaceAll("\\_", "_");
    const gatewayRequests = fs.existsSync(diagnostics)
      ? fs.readFileSync(diagnostics, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).filter((row) => row.type === "client_request").length
      : 0;
    const report = {
      mode,
      client: "Codex CLI",
      codexPath,
      exitCode: result.code,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      gatewayRequests,
      agentText
    };
    fs.writeFileSync(path.join(state, `codex-${mode}-smoke-report.json`), JSON.stringify(report, null, 2));
    assert.equal(result.code, 0, `Codex exited ${result.code}`);
    const expected = `CUHK_CODEX_${mode.toUpperCase()}_OK`;
    assert.match(agentText, new RegExp(expected));
    if (mode === "shell") {
      const execution = events.find((event) => event.type === "item.completed" && event.item?.type === "command_execution");
      assert.equal(execution?.item?.exit_code, 0, JSON.stringify(execution));
      assert.match(execution.item.aggregated_output, /CUHK_CODEX_SHELL_OK/);
      assert.ok(gatewayRequests >= 2, `Expected a tool continuation, saw ${gatewayRequests} request(s).`);
    }
    if (mode === "patch") {
      assert.ok(events.some((event) => event.type === "item.completed" && event.item?.type === "file_change"));
      assert.ok(gatewayRequests >= 2, `Expected a tool continuation, saw ${gatewayRequests} request(s).`);
      assert.equal(fs.readFileSync(path.join(workspace, "mvp-marker.txt"), "utf8"), `${expected}\n`);
    }
  } finally {
    try { await rpc("stopGateway"); } catch {}
    host.kill();
    await new Promise((resolve) => captureProxy.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  console.error(hostLogs.replaceAll(token, "[redacted]"));
  process.exitCode = 1;
});
