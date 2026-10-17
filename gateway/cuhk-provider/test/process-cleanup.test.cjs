"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("cleanup removes registered orphans and complete trees without trusting reused PIDs", {
  skip: process.platform !== "win32", timeout: 45000
}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cuhk cleanup "));
  const bin = path.join(root, "bin");
  const records = path.join(root, "gateway/runtime-state/processes");
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(records, { recursive: true });
  for (const name of ["cleanup-processes.ps1", "process-owner.cjs"]) {
    fs.copyFileSync(path.resolve(__dirname, "../../../bin", name), path.join(bin, name));
  }
  const processes = [];
  const launch = (code, owned) => {
    const child = spawn(process.execPath, ["-e", code], { windowsHide: true, detached: true, stdio: "ignore",
      env: { ...process.env, NODE_OPTIONS: owned ? `--require ${JSON.stringify(path.join(bin, "process-owner.cjs"))}` : "",
        CUHK_PROCESS_DIRECTORY: owned ? records : "" } });
    child.unref(); processes.push(child.pid); return child;
  };
  t.after(async () => {
    for (const pid of processes) { try { process.kill(pid); } catch {} }
    await delay(300);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const sentinel = launch("setInterval(() => {}, 1000)", false);
  // A stale ownership file must never terminate a new process with that PID.
  fs.writeFileSync(path.join(records, `${sentinel.pid}.json`), JSON.stringify({ pid: sentinel.pid,
    executable: process.execPath, startedAt: Date.now() - 60000 }));
  const orphanPidFile = path.join(root, "orphan-pid");
  const parent = launch(`const child = require('node:child_process').spawn(process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', windowsHide: true });
    require('node:fs').writeFileSync(${JSON.stringify(orphanPidFile)}, String(child.pid)); child.unref();`, true);
  const treePidFile = path.join(root, "tree-pid");
  const tree = launch(`const child = require('node:child_process').spawn(process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true, env: { ...process.env, NODE_OPTIONS: '', CUHK_PROCESS_DIRECTORY: '' } });
    require('node:fs').writeFileSync(${JSON.stringify(treePidFile)}, String(child.pid)); setInterval(() => {}, 1000);`, true);
  for (let i = 0; i < 100 && (!fs.existsSync(orphanPidFile) || !fs.existsSync(treePidFile) || alive(parent.pid)); i++) await delay(50);
  const orphan = Number(fs.readFileSync(orphanPidFile));
  const descendant = Number(fs.readFileSync(treePidFile));
  processes.push(orphan, descendant);
  for (let i = 0; i < 100 && !fs.existsSync(path.join(records, `${orphan}.json`)); i++) await delay(50);
  assert.equal(alive(parent.pid), false);
  assert.equal(alive(orphan), true);
  assert.equal(alive(tree.pid), true);
  assert.equal(alive(descendant), true);
  const cleanup = async () => JSON.parse((await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", path.join(bin, "cleanup-processes.ps1")], { windowsHide: true, timeout: 30000 })).stdout);
  assert.equal((await cleanup()).remaining, 0);
  for (const pid of [orphan, tree.pid, descendant]) assert.equal(alive(pid), false, `residual PID ${pid}`);
  assert.equal(alive(sentinel.pid), true, "unrelated process must survive");
  assert.equal((await cleanup()).remaining, 0, "repeated close is safe");
});
