"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "../../..");
const state = path.join(root, "gateway/runtime-state");
const cwd = path.join(state, "online-workspace/codex-regression");
fs.mkdirSync(cwd, { recursive: true });
fs.writeFileSync(path.join(state, "codex-online.ndjson"), "");
const prompt = `Use native local tools to complete both checks in this workspace. Do not call subagents.\n` +
  `1. Run one local command that uses Node crypto.randomBytes(16) to generate a random hexadecimal receipt at execution time, writes it to receipt.txt, and prints it.\n` +
  `2. Use the native apply_patch bridge to create proof.txt containing exactly that receipt followed by a newline. Do not write proof.txt using the shell.\n` +
  `3. Read proof.txt through a local shell command and check it matches receipt.txt. Finally report CODEXCOMPLETE followed by the real receipt. Do not repeat successful operations.`;
const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "bin/cuhk-codex.ps1"),
  // This CLI's Windows workspace-write profile currently denies even Get-Date.
  // The explicit smoke task has only three local file operations in this ignored
  // test directory. Normal launchers retain the client's normal permissions.
  "exec", "--skip-git-repo-check", "--json", "--sandbox", "danger-full-access"], { cwd, windowsHide: true });
let stdout = "", stderr = "";
child.stdout.on("data", d => { stdout += d; fs.appendFileSync(path.join(state, "codex-online.ndjson"), d); });
child.stderr.on("data", d => { stderr += d; });
child.stdin.end(prompt);
const timer = setTimeout(() => spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }), 1200000);
child.on("exit", code => {
  clearTimeout(timer); fs.writeFileSync(path.join(state, "codex-online.stderr.log"), stderr);
  try {
    assert.equal(code, 0, stderr + stdout.slice(-2000));
    const rows = stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const items = rows.filter(e => e.type === "item.completed").map(e => e.item);
    const receipt = fs.readFileSync(path.join(cwd, "receipt.txt"), "utf8").trim();
    assert.match(receipt, /^[a-f0-9]{32}$/);
    assert.equal(fs.readFileSync(path.join(cwd, "proof.txt"), "utf8").trim(), receipt);
    assert.ok(items.some(i => i.type === "command_execution" && i.exit_code === 0));
    assert.ok(items.some(i => i.type === "file_change" && i.status === "completed"));
    const final = items.filter(i => i.type === "agent_message").at(-1)?.text || "";
    assert.ok(final.includes(receipt), final);
    assert.doesNotMatch(stderr, /missing field models|ENAMETOOLONG|ENOENT/);
    const report = { ok: true, receipt, nativeShell: true, nativePatch: true, verifiedFile: true, final };
    fs.writeFileSync(path.join(state, "codex-online-report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (e) { console.error(e.stack); process.exitCode = 1; }
});
