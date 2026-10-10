"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "../../.."), state = path.join(root, "gateway/runtime-state");
const a = JSON.parse(fs.readFileSync(path.join(state, "qwen-tools-online-report.json"), "utf8"));
const b = JSON.parse(fs.readFileSync(path.join(state, "glm-tools-online-report.json"), "utf8"));
const configPath = path.join(root, "config.json"), previous = fs.readFileSync(configPath, "utf8");
function identity(session) {
  const ledger = JSON.parse(fs.readFileSync(path.join(state, "conversations.json"), "utf8"));
  const entries = ledger.conversations;
  return Array.isArray(entries) ? entries.find(e => e.key === `claude:${session}`)?.conversationUrl : entries[`claude:${session}`]?.conversationUrl;
}
async function resume(record, index) {
  fs.writeFileSync(configPath, JSON.stringify({ ...JSON.parse(previous), gatewayEnabled: true, model: record.model, thinking: "low" }));
  const cwd = path.join(state, "online-workspace", record.case);
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "bin/cuhk-claude.ps1"),
    "-p", "--resume", record.session, "--output-format", "stream-json", "--verbose", "--tools", "Read", "--setting-sources", "user", "--strict-mcp-config"], { cwd, windowsHide: true });
  let stdout = "", stderr = ""; child.stdout.on("data", d => { stdout += d; }); child.stderr.on("data", d => { stderr += d; });
  child.stdin.end("Do not use tools. Recall the exact random receipt and final stage from this session's original proof task. Reply ISOLATIONOK plus that receipt and stage.");
  const timer = setTimeout(() => spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }), 240000);
  const code = await new Promise(resolve => child.on("exit", resolve)); clearTimeout(timer);
  fs.writeFileSync(path.join(state, `claude-isolation-${index}.ndjson`), stdout);
  assert.equal(code, 0, stderr);
  const events = stdout.trim().split(/\r?\n/).map(JSON.parse), result = events.findLast(e => e.type === "result");
  assert.equal(result.is_error, false); assert.ok(result.result.includes(record.receipt), result.result); assert.match(result.result, /after/);
  assert.equal(events.filter(e => e.type === "assistant").flatMap(e => e.message.content).filter(c => c.type === "tool_use").length, 0);
  return { model: record.model, session: record.session, matchedReceipt: true, conversationUrl: identity(record.session) };
}
async function main() {
  const beforeA = identity(a.session), beforeB = identity(b.session);
  assert.ok(beforeA && beforeB); assert.notEqual(beforeA, beforeB);
  const runs = [];
  for (const [i, record] of [a, b, a].entries()) runs.push(await resume(record, i));
  assert.equal(runs[0].conversationUrl, beforeA); assert.equal(runs[1].conversationUrl, beforeB); assert.equal(runs[2].conversationUrl, beforeA);
  const report = { ok: true, order: "A-B-A", distinctUrls: true, sameUrlsRestored: true, runs };
  fs.writeFileSync(path.join(state, "claude-isolation-online-report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(() => fs.writeFileSync(configPath, previous));
