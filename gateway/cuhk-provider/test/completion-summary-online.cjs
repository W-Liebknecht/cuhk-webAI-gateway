"use strict";

// Real Codex CLI + provider + authenticated browser regression. The sole fault
// injection removes the first completed web answer's text, preserving its real
// final decision. All tools and the subsequent summary are executed/generated
// online. Run only with an idle browser and no other Gateway task in flight.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { codexExecutable } = require("../../../bin/cli-discovery.cjs");
const { ConfigStore } = require("../src/config.cjs");
const { CuhkProviderRuntime } = require("../src/runtime.cjs");
const { OpenCliTransport } = require("../src/transport.cjs");
const { parseAgentDecision } = require("../src/decision-protocol.cjs");
const { responseEvents } = require("../src/responses.cjs");

const root = path.resolve(__dirname, "../../..");
const directory = path.join(root, "gateway/runtime-state", `completion-summary-${Date.now()}`);
const workspace = path.join(directory, "workspace");
const clientHome = path.join(directory, "codex-home");
fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(clientHome, { recursive: true });
const diagnosticPath = path.join(directory, "web.ndjson");
const controls = [];
let injected = 0;
const transport = new OpenCliTransport({
  entryPath: path.join(root, "bin/cuhk-ai.mjs"),
  statusEntryPath: path.join(root, "bin/cuhk-opencli.mjs"),
  diagnosticPath
});
const realAsk = transport.ask.bind(transport);
transport.ask = async input => {
  const result = await realAsk(input);
  const session = runtime.sessions.get(input.sessionId);
  const decision = parseAgentDecision(result.text, session.tools, { allowMissingAnswer: true, style: session.profile.parserStyle });
  if (!injected && decision?.kind === "final") {
    injected++;
    return { ...result, text: '```cuhk-decision\n{"version":1,"decision":"final","reason":"goal_satisfied"}\n```' };
  }
  return result;
};
const runtime = new CuhkProviderRuntime({
  configStore: new ConfigStore(path.join(root, "config.json")),
  transport,
  log: entry => controls.push(entry)
});
const token = crypto.randomBytes(24).toString("hex");
const server = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); res.end(); return; }
  if (req.method === "GET" && req.url.startsWith("/v1/models")) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(runtime.codexModelCatalog()));
    return;
  }
  try {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/responses");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const result = await runtime.respond(JSON.parse(Buffer.concat(chunks)));
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of responseEvents(result)) res.write(`data: ${JSON.stringify(event)}\n\n`);
    res.end("data: [DONE]\n\n");
  } catch (error) {
    res.writeHead(error.status || 500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: error.message } }));
  }
});

async function main() {
  await runtime.ensureTransportReady(true);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const args = [
    "-c", 'model_provider="completion_test"', "-c", 'model="gpt-5.6-sol"',
    "-c", 'approval_policy="never"',
    "-c", 'model_providers.completion_test.name="CUHK completion test"',
    "-c", `model_providers.completion_test.base_url="http://127.0.0.1:${server.address().port}/v1"`,
    "-c", 'model_providers.completion_test.env_key="CUHK_COMPLETION_TEST_KEY"',
    "-c", 'model_providers.completion_test.wire_api="responses"',
    "-c", "model_providers.completion_test.stream_idle_timeout_ms=1800000",
    "exec", "--json", "--ephemeral", "--skip-git-repo-check", "--sandbox", "danger-full-access"
  ];
  const child = spawn(codexExecutable(), args, {
    cwd: workspace, windowsHide: true,
    env: { ...process.env, CODEX_HOME: clientHome, CUHK_COMPLETION_TEST_KEY: token, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" }
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", data => { stdout += data; fs.appendFileSync(path.join(directory, "cli.ndjson"), data); });
  child.stderr.on("data", data => { stderr += data; });
  child.stdin.end("Use exactly one local shell command to generate a random 16-byte hexadecimal receipt with Node crypto.randomBytes(16), write it to receipt.txt and print it. Do not call subagents or repeat the command. When done, give a short text summary containing the real receipt and whether the command succeeded.");
  const timer = setTimeout(() => spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }), 900000);
  let code;
  try {
    code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
  } finally { clearTimeout(timer); fs.writeFileSync(path.join(directory, "stderr.log"), stderr); }
  assert.equal(code, 0, stderr + stdout.slice(-2000));
  const events = stdout.trim().split(/\r?\n/).map(JSON.parse);
  const items = events.filter(e => e.type === "item.completed").map(e => e.item);
  const commands = items.filter(i => i.type === "command_execution");
  assert.equal(commands.length, 1, "summary recovery must not repeat local commands");
  assert.equal(commands[0].exit_code, 0);
  const receipt = fs.readFileSync(path.join(workspace, "receipt.txt"), "utf8").trim();
  assert.match(receipt, /^[a-f0-9]{32}$/u);
  const final = items.filter(i => i.type === "agent_message").at(-1)?.text || "";
  assert.ok(final.includes(receipt), "CLI must receive a textual summary containing the actual receipt");
  assert.equal(injected, 1, "the missing-answer path must actually be exercised");
  assert.equal(controls.filter(e => e.reason === "missing_final_answer").length, 1);
  assert.equal(runtime.activeSessionId, null);
  assert.equal(runtime.pendingCalls.size, 0);
  const report = { ok: true, faultInjection: "first real final answer body omitted", commands: commands.length, summaryRequested: true, receipt, final };
  fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, directory }));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => {
  server.close();
  server.closeAllConnections();
});
