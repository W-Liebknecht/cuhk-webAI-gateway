"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function fixture(t, client, failure = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `cuhk ${client} launcher `));
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  const source = path.resolve(__dirname, "../../../bin");
  for (const name of ["runtime.ps1", "process-owner.cjs", `cuhk-${client}-launch.ps1`]) {
    fs.copyFileSync(path.join(source, name), path.join(bin, name));
  }
  fs.writeFileSync(path.join(root, "config.json"), '{"gatewayEnabled":true}');
  fs.writeFileSync(path.join(bin, `cuhk-${client}.ps1`), `
    $receipt = @{ client = '${client}'; cwd = (Get-Location).Path; args = @($args) } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path (Split-Path -Parent $PSScriptRoot) 'client-entered'), $receipt)
    exit 0
  `);
  fs.writeFileSync(path.join(bin, "cuhk-gateway.cjs"), `
    if (process.argv[2] === 'stop') {
      require('node:fs').appendFileSync(require('node:path').join(__dirname, '../cleanup-calls'), 'stop\\n');
      process.exit(0);
    }
  ` + (failure ?
    `console.error('fixture startup failure'); process.exitCode = 7;` : `
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.resolve(__dirname, '..');
    const pidFile = path.join(root, 'server-pid');
    if (!fs.existsSync(pidFile)) {
      const child = require('node:child_process').spawn(process.execPath,
        ['-e', 'setTimeout(() => {}, 30000)'],
        { detached: true, windowsHide: true, stdio: 'ignore' });
      fs.writeFileSync(pidFile, String(child.pid));
      child.unref();
      console.log('fixture cold start');
    } else { console.log('fixture already running'); }
  `));
  t.after(async () => {
    try { process.kill(Number(fs.readFileSync(path.join(root, "server-pid"), "utf8"))); } catch {}
    // Windows releases a terminated process's working-directory handle later.
    await new Promise(resolve => setTimeout(resolve, 300));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return root;
}

function launch(root, client) {
  // File handles avoid waiting for EOF from a detached Windows descendant
  // which may inherit the test runner's output pipe handles.
  const output = path.join(root, 'launch-output');
  const error = path.join(root, 'launch-error');
  const outFd = fs.openSync(output, 'w');
  const errFd = fs.openSync(error, 'w');
  let result;
  try { result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", path.join(root, `bin/cuhk-${client}-launch.ps1`)], {
    cwd: root, env: { ...process.env, CUHK_NODE_EXE: process.execPath },
    stdio: ['ignore', outFd, errFd], timeout: 15000, windowsHide: true
  }); } finally { fs.closeSync(outFd); fs.closeSync(errFd); }
  return { ...result, stdout: fs.readFileSync(output, 'utf8'), stderr: fs.readFileSync(error, 'utf8') };
}

for (const client of ['claude', 'codex']) {
test(`${client} launcher hands off both cold and existing Gateway starts to its own client`, {
  skip: process.platform !== "win32"
}, t => {
  const root = fixture(t, client);
  for (const status of ["cold start", "already running"]) {
    const result = launch(root, client);
    assert.equal(result.error, undefined, result.stdout + result.stderr);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, new RegExp(`fixture ${status}`));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "client-entered"), "utf8")),
      { client, cwd: root, args: client === 'codex' ? ['resume'] : [] });
    assert.ok(fs.existsSync(path.join(root, `gateway/runtime-state/${client}-home`)));
    assert.equal(fs.existsSync(path.join(root, `gateway/runtime-state/${client === 'codex' ? 'claude' : 'codex'}-home`)), false);
    assert.equal(fs.readdirSync(path.join(root, "gateway/runtime-state")).some(name => name.startsWith("gateway-start-")), false);
    fs.unlinkSync(path.join(root, "client-entered"));
  }
  assert.equal(fs.readFileSync(path.join(root, 'cleanup-calls'), 'utf8'), 'stop\nstop\n');
});

test(`${client} launcher reports Gateway failure and does not start the client`, {
  skip: process.platform !== "win32"
}, t => {
  const root = fixture(t, client, true);
  const result = launch(root, client);
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /fixture startup failure/);
  assert.match(result.stdout, /exit code 7/);
  assert.equal(fs.existsSync(path.join(root, "client-entered")), false);
});
}
