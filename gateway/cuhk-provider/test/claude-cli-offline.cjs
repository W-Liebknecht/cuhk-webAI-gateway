"use strict";
// Explicit native CLI integration test: no CUHK/browser/model/network request.
// Run: node gateway/cuhk-provider/test/claude-cli-offline.cjs
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const plugin = require("../index.cjs");
const { OpenCliTransport } = require("../src/transport.cjs");
const root = path.resolve(__dirname, "../../..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cuhk-claude-offline-"));
const workspace = path.join(temporary, "workspace");
const bridge = path.join(temporary, "bridge");
fs.mkdirSync(workspace); fs.mkdirSync(path.join(bridge, "bin"), { recursive: true });
fs.mkdirSync(path.join(workspace, ".claude"));
fs.writeFileSync(path.join(workspace, ".claude/settings.json"), JSON.stringify({ env: {
  ANTHROPIC_BASE_URL: "http://127.0.0.1:1", ANTHROPIC_API_KEY: "wrong-project-key", ANTHROPIC_AUTH_TOKEN: "wrong-project-token", ANTHROPIC_MODEL: "wrong-project-model"
} }));
fs.mkdirSync(path.join(bridge, "gateway/runtime-state"), { recursive: true });
fs.copyFileSync(path.join(root, "bin/cuhk-claude.ps1"), path.join(bridge, "bin/cuhk-claude.ps1"));
const receipt = crypto.randomBytes(16).toString("hex");
const file = path.join(workspace, "proof.txt");
const routes = [];
let turns = 0;
const outputs = [
  { name: "Write", arguments: { file_path: file, content: "before" } },
  { name: "Read", arguments: { file_path: file } },
  { name: "Edit", arguments: { file_path: file, old_string: "before", new_string: "after" } },
  { name: "Bash", arguments: { command: `printf '${receipt}'`, description: "Print verification receipt" } },
  { name: "Bash", arguments: { command: `node -e "setTimeout(()=>console.log('BACKGROUND${receipt}'),1500)"`, run_in_background: true, description: "Start a background verification command" } }
];
const originalAsk = OpenCliTransport.prototype.ask;
OpenCliTransport.prototype.ask = async function(call) {
  if (turns === 1) assert.match(call.prompt, /written|created|success/i);
  if (turns === 2) assert.match(call.prompt, /before/);
  if (turns === 3) assert.match(call.prompt, /updated|success|modified/i);
  if (turns === 4) assert.match(call.prompt, new RegExp(receipt));
  let next = outputs[turns];
  if (turns === 5) {
    const taskId = /(?:ID:|task_id["']?\s*[:=]|<task_id>)\s*["']?([a-z0-9_-]+)/i.exec(call.prompt)?.[1];
    assert.ok(taskId, "Native Bash must return its background task ID: " + call.prompt.slice(-1800));
    const outputPath = /Output is being written to: ([^\r\n]+?)\. You will/i.exec(call.prompt)?.[1];
    assert.ok(outputPath, "Native Bash must return its output file path");
    await new Promise(resolve => setTimeout(resolve, 2000));
    next = { name: "Read", arguments: { file_path: outputPath } };
  }
  if (turns === 6) {
    assert.match(call.prompt, new RegExp(`BACKGROUND${receipt}`));
    next = { name: "Read", arguments: { file_path: path.join(workspace, "deliberately-missing.txt") } };
  }
  if (turns === 7) assert.match(call.prompt, /tool execution error.*\n|does not exist|not found/i);
  turns++;
  return { text: next ? `<tool_call>${JSON.stringify(next)}</tool_call>` : `CLAUDE_OFFLINE_TOOLS_OK ${receipt}`,
    conversationId: "https://ai.cuhk.edu.cn/chat/c/offline" };
};
const configPath = path.join(temporary, "config.json");
fs.writeFileSync(configPath, JSON.stringify({ gatewayEnabled: true, model: "qwen3.8-27b", thinking: "low" }));
async function main() {
  await plugin.setup({ pluginConfig: { configPath, openCliStatusEntryPath: false, conversationStatePath: path.join(temporary, "ledger.json") },
    registerGatewayRoute: route => routes.push(route), registerHttpBackend: async () => {}, logger: { info() {}, error() {} } });
  const server = http.createServer(async (request, response) => {
    const route = routes.find(r => r.path === new URL(request.url, "http://local").pathname);
    if (!route) { response.writeHead(404); response.end(); return; }
    assert.ok(request.headers["x-api-key"] === "offline-fixture" || request.headers.authorization === "Bearer offline-fixture");
    assert.ok(Number(request.headers["x-cuhk-owner-pid"]) > 0);
    await route.handler(request, response, { readJson: async req => {
      let data = ""; for await (const chunk of req) data += chunk; return JSON.parse(data);
    }, sendJson: (res, status, value) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); } });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  fs.writeFileSync(path.join(bridge, "gateway/runtime-state/control.json"), JSON.stringify({ gatewayKey: "offline-fixture", ports: { gateway: server.address().port } }));
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(bridge, "bin/cuhk-claude.ps1"),
    "-p", "Perform the requested local checks and report completion.", "--tools", "Write,Read,Edit,Bash", "--allowedTools", "Write,Read,Edit,Bash",
    "--setting-sources", "user,project,local", "--strict-mcp-config", "--output-format", "json"], { cwd: workspace,
      env: { ...process.env, ANTHROPIC_AUTH_TOKEN: "must-be-cleared", CLAUDE_CODE_USE_BEDROCK: "1" }, windowsHide: true });
  let stdout = "", stderr = "";
  child.stdin.end();
  child.stdout.on("data", d => { stdout += d; }); child.stderr.on("data", d => { stderr += d; });
  const timeout = setTimeout(() => spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }), 90000);
  const code = await new Promise(resolve => child.on("exit", resolve)); clearTimeout(timeout); server.closeAllConnections(); server.close();
  assert.equal(code, 0, stderr + stdout);
  const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(result.is_error, false, JSON.stringify(result));
  assert.equal(result.modelUsage["cuhk-gateway"].contextWindow, 100000, "native client must use the gateway display scale");
  assert.match(result.result, new RegExp(receipt));
  assert.equal(turns, 8); assert.equal(fs.readFileSync(file, "utf8"), "after");
  assert.equal(result.permission_denials.length, 0);
  assert.equal(result.subagent_stats.spawned, 0);
  const report = { ok: true, tools: ["Write", "Read", "Edit", "Bash"], turns, receipt, backgroundProcess: true, backgroundRead: true, errorResult: true, isolatedHome: true, inheritedProviderCleared: true, projectRouteOverridden: true, contextWindow: 100000 };
  fs.mkdirSync(path.join(root, "gateway/runtime-state"), { recursive: true });
  fs.writeFileSync(path.join(root, "gateway/runtime-state/claude-offline-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(() => { OpenCliTransport.prototype.ask = originalAsk; });
