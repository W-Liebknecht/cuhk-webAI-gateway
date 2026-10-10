"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const plugin = require("../index.cjs");
const { OpenCliTransport } = require("../src/transport.cjs");
const { UpstreamError } = require("../src/errors.cjs");
async function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cuhk-messages-http-"));
  const configPath = path.join(directory, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ gatewayEnabled: true, model: "qwen3.8-27b", thinking: "low" }));
  // Leave the temporary fixtures in the OS temp directory; watches are unref'd.
  const routes = [];
  await plugin.setup({ pluginConfig: { configPath, openCliStatusEntryPath: false, conversationStatePath: path.join(directory, "ledger.json") },
    registerGatewayRoute: route => routes.push(route), registerHttpBackend: async () => {}, logger: { info() {}, error() {} } });
  assert.ok(routes.filter(r => r.method === "POST").every(r => r.auth === "gateway"));
  return routes;
}
function response() {
  const res = new EventEmitter();
  Object.assign(res, { headersSent: false, writableEnded: false, chunks: [], status: null,
    writeHead(status) { this.status = status; this.headersSent = true; },
    write(chunk) { this.chunks.push(chunk); }, end() { this.writableEnded = true; } });
  return res;
}
function request() { return Object.assign(new EventEmitter(), { method: "POST", url: "/v1/messages", headers: {} }); }
const body = { model: "gateway", max_tokens: 100, messages: [{ role: "user", content: "hello" }] };
function helpers(b, res) { return { readJson: async () => b, sendJson: (_res, status, value) => { res.status = status; res.json = value; res.writableEnded = true; } }; }

test("authenticated Messages route returns native JSON and count_tokens does not use browser", async t => {
  let calls = 0;
  t.mock.method(OpenCliTransport.prototype, "ask", async () => { calls++; return { text: "hello" }; });
  const routes = await setup(t);
  const res = response();
  await routes.find(r => r.path === "/v1/messages").handler(request(), res, helpers(body, res));
  assert.equal(res.status, 200); assert.equal(res.json.type, "message"); assert.equal(res.json.content[0].text, "hello");
  const count = response();
  const tokenBody = { ...body }; delete tokenBody.max_tokens;
  await routes.find(r => r.path === "/v1/messages/count_tokens").handler(request(), count, helpers(tokenBody, count));
  assert.equal(count.status, 200); assert.ok(count.json.input_tokens > 0); assert.equal(calls, 1);
});
test("slow Messages streams ping, then native error, and clear the heartbeat", async t => {
  let rejectTurn;
  t.mock.method(OpenCliTransport.prototype, "ask", () => new Promise((_resolve, reject) => { rejectTurn = reject; }));
  t.mock.timers.enable({ apis: ["setInterval"] });
  const routes = await setup(t), res = response();
  const pending = routes.find(r => r.path === "/v1/messages").handler(request(), res, helpers({ ...body, stream: true }, res));
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(10000);
  assert.match(res.chunks.join(""), /event: ping/);
  rejectTurn(new UpstreamError("web timed out", { code: "cuhk_timeout" }));
  await pending;
  assert.match(res.chunks.join(""), /event: error/); assert.doesNotMatch(res.chunks.join(""), /response.failed|\[DONE\]/);
  assert.equal(res.writableEnded, true);
  const count = res.chunks.length; t.mock.timers.tick(30000); assert.equal(res.chunks.length, count);
});
test("invalid Messages requests fail before any browser write", async t => {
  t.mock.method(OpenCliTransport.prototype, "ask", () => assert.fail("invalid request reached browser"));
  const routes = await setup(t), res = response();
  await routes.find(r => r.path === "/v1/messages").handler(request(), res, helpers({ ...body, messages: [] }, res));
  assert.equal(res.status, 400); assert.equal(res.json.type, "error"); assert.equal(res.json.error.type, "invalid_request_error");
});
