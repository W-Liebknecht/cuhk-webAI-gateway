"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../../..");
const state = path.join(root, "gateway/runtime-state");
const control = JSON.parse(fs.readFileSync(path.join(state, "control.json"), "utf8"));
const url = `http://127.0.0.1:${control.ports.gateway}`;
const configPath = path.join(root, "config.json"), previous = fs.readFileSync(configPath, "utf8");
const headers = { "content-type": "application/json", "x-api-key": control.gatewayKey };
const body = { model: "cuhk-gateway", max_tokens: 100, messages: [{ role: "user", content: "Reply with exactly RECONNECTOK" }],
  metadata: { user_id: JSON.stringify({ session_id: crypto.randomUUID() }) }, stream: true };
const diagnostic = path.join(state, "claude-online.ndjson");
function submissions() { return fs.readFileSync(diagnostic, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse).filter(r => r.type === "web_submit").length; }
async function post(p, b, h = headers) { return fetch(url + p, { method: "POST", headers: h, body: JSON.stringify(b) }); }
async function main() {
  const readiness = await fetch(url + "/plugins/cuhk/health/ready").then(r => r.json());
  assert.equal(readiness.ok, true); assert.equal(readiness.active_sessions, 0, "run this test with an idle browser");
  const checks = [];
  for (const [name, key, expected] of [["missing key", null, 401], ["wrong key", "wrong", 401]]) {
    const r = await post("/v1/messages", body, { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}) });
    assert.equal(r.status, expected); checks.push({ name, status: r.status });
  }
  let r = await post("/v1/messages", { ...body, messages: [] }); assert.equal(r.status, 400); checks.push({ name: "invalid input", status: r.status });
  const beforeLocal = submissions();
  r = await post("/v1/messages/count_tokens", { model: body.model, messages: body.messages });
  assert.equal(r.status, 200); assert.ok((await r.json()).input_tokens > 0); assert.equal(submissions(), beforeLocal);
  checks.push({ name: "local token estimate", status: r.status, webCalls: 0 });
  fs.writeFileSync(configPath, JSON.stringify({ ...JSON.parse(previous), gatewayEnabled: false }));
  r = await post("/v1/messages", { ...body, stream: false }); assert.equal(r.status, 503); assert.equal(submissions(), beforeLocal);
  checks.push({ name: "disabled panel gate", status: r.status, webCalls: 0 });
  fs.writeFileSync(configPath, previous);
  const before = submissions();
  const abort = new AbortController();
  const first = await fetch(url + "/v1/messages", { method: "POST", headers, body: JSON.stringify(body), signal: abort.signal });
  assert.equal(first.status, 200);
  const firstChunk = await first.body.getReader().read();
  assert.ok(firstChunk.value?.length); abort.abort();
  const retry = await post("/v1/messages", body); assert.equal(retry.status, 200);
  const stream = await retry.text();
  assert.match(stream, /RECONNECTOK/); assert.match(stream, /event: message_stop/);
  assert.equal(submissions() - before, 1, "dropped SSE must not submit a second web prompt");
  checks.push({ name: "stream disconnect and identical retry", status: retry.status, webCalls: 1 });
  const report = { ok: true, checks };
  fs.writeFileSync(path.join(state, "anthropic-api-online-report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(() => fs.writeFileSync(configPath, previous));
