"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const plugin = require("../index.cjs");
const { cuhkProvider } = require("../src/ccr-registration.cjs");

test("CCR provider catalog includes the selectable Qwen model", () => {
  assert.ok(cuhkProvider().models.includes("qwen3.8-27b"));
});

test("CCR wrapper contract registers the required loopback gateway routes", async () => {
  const routes = [];
  const messages = [];
  const backends = [];
  await plugin.setup({
    pluginConfig: { openCliStatusEntryPath: false },
    registerGatewayRoute(route) { routes.push(route); },
    async registerHttpBackend(backend) { backends.push(backend); },
    logger: {
      debug() {},
      error(message) { messages.push(message); },
      info(message) { messages.push(message); },
      warn() {}
    }
  });
  assert.deepEqual(routes.map((route) => `${route.method} ${route.path}`).sort(), [
    "GET /models",
    "GET /plugins/cuhk/health/ready",
    "GET /v1/models",
    "POST /messages", "POST /messages/count_tokens", "POST /v1/messages", "POST /v1/messages/count_tokens"
  ]);
  assert.equal(backends[0].host, "127.0.0.1");
  assert.equal(backends[0].port, 3462);
  assert.equal(routes.find((route) => route.path === "/plugins/cuhk/health/ready").auth, "none");
  assert.match(messages.at(-1), /registered/);
});

test("models gateway route serves a decodable Codex ModelsResponse", async () => {
  const routes = [];
  await plugin.setup({
    pluginConfig: { configPath: require("node:path").join(__dirname, "smoke-config.json"), openCliStatusEntryPath: false },
    registerGatewayRoute(route) { if (route.path === "/v1/models") routes.push(route); },
    async registerHttpBackend() {},
    logger: { debug() {}, error() {}, info() {}, warn() {} }
  });
  const route = routes[0];
  assert.ok(route, "GET /v1/models gateway route must be registered");
  assert.equal(route.auth, "none");

  const sent = { body: null, status: null };
  route.handler({}, {}, { sendJson(res, status, body) { sent.status = status; sent.body = body; } });
  assert.equal(sent.status, 200);
  // codex-rs ModelsResponse requires exactly a top-level `models` array; an empty
  // catalog decodes cleanly while preserving Codex's bundled fallback metadata.
  assert.deepEqual(sent.body, { models: [] });
});

test('slow streamed turns send heartbeats and terminate with a structured error', async (t) => {
  const { EventEmitter } = require('node:events');
  const { OpenCliTransport } = require('../src/transport.cjs');
  const { UpstreamError } = require('../src/errors.cjs');
  let rejectTurn;
  t.mock.method(OpenCliTransport.prototype, 'ask', () => new Promise((_resolve, reject) => { rejectTurn = reject; }));
  t.mock.timers.enable({ apis: ['setInterval'] });
  let backend;
  await plugin.setup({
    pluginConfig: { configPath: require('node:path').join(__dirname, 'smoke-config.json'), openCliStatusEntryPath: false },
    registerGatewayRoute() {},
    async registerHttpBackend(value) { backend = value; },
    logger: { info() {}, error() {} }
  });
  const request = new EventEmitter();
  Object.assign(request, { method: 'POST', url: '/v1/responses' });
  const response = new EventEmitter();
  const chunks = [];
  Object.assign(response, {
    headersSent: false, writableEnded: false,
    writeHead(status) { assert.equal(status, 200); this.headersSent = true; },
    write(chunk) { chunks.push(chunk); },
    end() { this.writableEnded = true; }
  });
  const pending = backend.handler(request, response, {
    readJson: async () => ({ input: 'slow test', stream: true }),
    sendJson() { assert.fail('must not write JSON after SSE headers'); }
  });
  await new Promise(done => setImmediate(done));
  t.mock.timers.tick(10000);
  assert.match(chunks.join(''), /: cuhk waiting/);
  rejectTurn(new UpstreamError('web timed out', { code: 'cuhk_timeout' }));
  await pending;
  assert.match(chunks.join(''), /event: error/);
  assert.match(chunks.join(''), /event: response.failed/);
  assert.match(chunks.join(''), /cuhk_timeout/);
  assert.equal(response.writableEnded, true);
  const count = chunks.length;
  t.mock.timers.tick(20000);
  assert.equal(chunks.length, count);
});
