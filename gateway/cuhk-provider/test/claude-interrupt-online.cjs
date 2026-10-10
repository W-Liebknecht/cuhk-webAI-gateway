"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "../../.."), state = path.join(root, "gateway/runtime-state");
const control = JSON.parse(fs.readFileSync(path.join(state, "control.json"), "utf8"));
const readyUrl = `http://127.0.0.1:${control.ports.gateway}/plugins/cuhk/health/ready`;
const cwd = path.join(state, "online-workspace/interrupt"); fs.mkdirSync(cwd, { recursive: true });
function launch(prompt, onEvent = () => {}) {
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "bin/cuhk-claude.ps1"),
    "-p", "--output-format", "stream-json", "--verbose", "--tools", "Bash", "--allowedTools", "Bash", "--setting-sources", "user", "--strict-mcp-config"], { cwd, windowsHide: true });
  let output = "", buffer = "", stderr = "";
  child.stdout.on("data", chunk => { output += chunk; buffer += chunk; const lines = buffer.split(/\r?\n/); buffer = lines.pop();
    for (const line of lines) { try { onEvent(JSON.parse(line)); } catch {} } });
  child.stderr.on("data", chunk => { stderr += chunk; }); child.stdin.end(prompt);
  const done = new Promise(resolve => child.on("exit", code => resolve({ code, output, stderr })));
  return { child, done };
}
async function waitFor(predicate, timeout = 30000) {
  const start = Date.now(); while (Date.now() - start < timeout) {
    const r = await fetch(readyUrl).then(r => r.json()); if (predicate(r)) return r;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error("gateway readiness condition did not converge");
}
async function main() {
  await waitFor(r => r.ok && r.active_sessions === 0);
  let sawTool;
  const tool = new Promise(resolve => { sawTool = resolve; });
  const run = launch('Use Bash exactly once to execute node -e "setTimeout(()=>console.log(\'INTERRUPTLONGCOMMAND\'),30000)". Wait for the real result before answering. Do not call agents.', event => {
    if (event.type === "assistant" && event.message.content.some(b => b.type === "tool_use")) sawTool();
  });
  const timeout = setTimeout(() => spawn("taskkill", ["/PID", String(run.child.pid), "/T", "/F"], { windowsHide: true }), 240000);
  try {
    await tool;
    const pending = await waitFor(r => r.pending_tool_calls === 1 && r.active_sessions === 1);
    await new Promise(resolve => {
      const killer = spawn("taskkill", ["/PID", String(run.child.pid), "/T", "/F"], { windowsHide: true }); killer.on("exit", resolve);
    });
    const interrupted = await run.done;
    fs.writeFileSync(path.join(state, "claude-interrupt.ndjson"), interrupted.output);
    const released = await waitFor(r => r.pending_tool_calls === 0 && r.active_sessions === 0);
    const followup = launch("Without tools reply exactly INTERRUPTRECOVERYOK.");
    const next = await followup.done;
    fs.writeFileSync(path.join(state, "claude-interrupt-recovery.ndjson"), next.output);
    assert.equal(next.code, 0, next.stderr);
    const result = next.output.trim().split(/\r?\n/).map(JSON.parse).findLast(e => e.type === "result");
    assert.equal(result.is_error, false); assert.match(result.result, /INTERRUPTRECOVERYOK/);
    const report = { ok: true, nativeCliTerminated: true, pendingBefore: pending.pending_tool_calls, pendingAfter: released.pending_tool_calls, newTaskCompleted: true };
    fs.writeFileSync(path.join(state, "claude-interrupt-online-report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { clearTimeout(timeout); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
