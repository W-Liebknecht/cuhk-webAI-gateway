"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ConfigStore } = require("./src/config.cjs");
const { errorBody } = require("./src/errors.cjs");
const { responseEvents } = require("./src/responses.cjs");
const { CuhkProviderRuntime } = require("./src/runtime.cjs");
const { OpenCliTransport } = require("./src/transport.cjs");

function createRuntime(ctx) {
  const pluginConfig = ctx.pluginConfig && typeof ctx.pluginConfig === "object" ? ctx.pluginConfig : {};
  const bridgeRoot = path.resolve(__dirname, "..", "..");
  const configPath = pluginConfig.configPath || path.join(bridgeRoot, "config.json");
  const entryPath = pluginConfig.openCliEntryPath || path.join(bridgeRoot, "bin", "cuhk-ai.mjs");
  const statusEntryPath = pluginConfig.openCliStatusEntryPath === false ? null
    : pluginConfig.openCliStatusEntryPath || path.resolve(bridgeRoot, "..", "cuhk-ai-opencli", "dist", "src", "main.js");
  // Conversation-reuse ledger (digests only). Lives under the gitignored runtime state.
  const persistPath = pluginConfig.conversationStatePath || path.join(bridgeRoot, "gateway", "runtime-state", "conversations.json");
  const timeoutSeconds = pluginConfig.timeoutSeconds || 1800;
  return new CuhkProviderRuntime({
    configStore: new ConfigStore(configPath),
    transport: new OpenCliTransport({
      entryPath,
      nodePath: pluginConfig.nodePath || process.execPath,
      timeoutSeconds,
      statusEntryPath,
      diagnosticPath: pluginConfig.diagnosticPath
    }),
    persistPath,
    // One transport call plus the OpenCLI startup slack, plus a minute of grace.
    staleTurnMs: pluginConfig.staleTurnMs || (timeoutSeconds + 20) * 1000 + 60000,
    log: (message) => ctx.logger.info(message)
  });
}

function appendDiagnostic(filePath, row) {
  if (!filePath) return;
  fs.appendFileSync(filePath, JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n", "utf8");
}

function sendSse(response, events) {
  if (!response.headersSent) response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  response.write("data: [DONE]\n\n");
  response.end();
}

module.exports = {
  async setup(ctx) {
    const runtime = createRuntime(ctx);
    // Browser probing may need to attach to Chrome and can outlive CCR's
    // five-second plugin startup RPC. Warm the cache without blocking route
    // registration; request handling and the readiness route still await it.
    runtime.ensureTransportReady(true).catch(() => {});
    const ownerWatch = setInterval(() => runtime.reapDisconnectedClients(), 1000);
    ownerWatch.unref();
    const readinessWatch = setInterval(() => runtime.ensureTransportReady(true).catch(() => {}), 30000);
    readinessWatch.unref();
    if (ctx.pluginConfig?.diagnosticPath) {
      fs.mkdirSync(path.dirname(ctx.pluginConfig.diagnosticPath), { recursive: true });
      appendDiagnostic(ctx.pluginConfig.diagnosticPath, { type: "diagnostic_ready" });
    }
    await ctx.registerHttpBackend({
      id: "cuhk-responses",
      host: "127.0.0.1",
      port: ctx.pluginConfig?.backendPort || 3462,
      async handler(request, response, helpers) {
        let heartbeat;
        try {
          const pathname = new URL(request.url, "http://localhost").pathname;
          if (request.method !== "POST" || !["/v1/responses", "/responses"].includes(pathname)) {
            helpers.sendJson(response, 404, { error: { message: "Unknown CUHK backend endpoint" } });
            return;
          }
          const body = await helpers.readJson(request);
          await runtime.ensureTransportReady();
          // A Codex interrupt (Ctrl+C) closes the request while OpenCLI is still
          // typing into the browser. Track it so the turn frees its session instead
          // of leaving the next request wedged on the single-active-session guard.
          const requestState = { aborted: false };
          request.once("aborted", () => { requestState.aborted = true; });
          response.once("close", () => { if (!response.writableEnded) requestState.aborted = true; });
          appendDiagnostic(ctx.pluginConfig?.diagnosticPath, {
            type: "request",
            conversationKey: body.prompt_cache_key || body.client_metadata?.session_id || body.client_metadata?.thread_id || null,
            stream: body.stream === true,
            body
          });
          if (body.stream === true) {
            heartbeat = setInterval(() => {
              if (response.destroyed || response.writableEnded) return;
              if (!response.headersSent) response.writeHead(200, {
                "content-type": "text/event-stream; charset=utf-8",
                "cache-control": "no-cache", connection: "keep-alive"
              });
              response.write(": cuhk waiting for web response\n\n");
            }, 10000);
            heartbeat.unref();
          }
          const result = await runtime.respond(body, requestState);
          appendDiagnostic(ctx.pluginConfig?.diagnosticPath, {
            type: "response",
            conversationKey: body.prompt_cache_key || body.client_metadata?.session_id || body.client_metadata?.thread_id || null,
            responseId: result.id,
            status: result.status,
            outputTypes: Array.isArray(result.output) ? result.output.map((item) => item.type) : []
          });
          if (response.destroyed || response.writableEnded) return;
          // Preserve the routed public name while OpenCLI uses school aliases.
          result.model = body.model || result.model;
          if (body.stream === true) sendSse(response, responseEvents(result));
          else helpers.sendJson(response, 200, result);
        } catch (error) {
          appendDiagnostic(ctx.pluginConfig?.diagnosticPath, { type: "error", name: error?.name, code: error?.code, status: error?.status, message: error?.message });
          ctx.logger.error(error instanceof Error ? error.message : String(error));
          if (response.destroyed || response.writableEnded) return;
          if (response.headersSent) {
            response.write(`event: response.failed\ndata: ${JSON.stringify({ type: 'response.failed', response: {
              id: `resp_failed_${Date.now()}`, object: 'response', created_at: Math.floor(Date.now() / 1000),
              status: 'failed', output: [], error: { code: error.code || 'cuhk_upstream_error', message: error.message }
            } })}\n\n`);
            response.write(`event: error\ndata: ${JSON.stringify({ type: "error", ...errorBody(error), code: error.code, message: error.message })}\n\n`);
            response.end();
          } else helpers.sendJson(response, error.status || 500, errorBody(error));
        } finally {
          clearInterval(heartbeat);
        }
      }
    });
    ctx.registerGatewayRoute({
      auth: "none",
      id: "cuhk-ready",
      method: "GET",
      path: "/plugins/cuhk/health/ready",
      async handler(_request, response, helpers) {
        try {
          await runtime.ensureTransportReady();
          const status = runtime.readiness();
          helpers.sendJson(response, status.ok ? 200 : 503, status);
        } catch (error) {
          helpers.sendJson(response, 503, errorBody(error));
        }
      }
    });
    // Serves the Codex models-manager catalog before CCR's built-in OpenAI-shaped
    // /v1/models response; gateway routes are matched first in handleRequest.
    for (const modelsPath of ["/v1/models", "/models"]) {
      ctx.registerGatewayRoute({
        auth: "none",
        id: `cuhk-models:${modelsPath}`,
        method: "GET",
        path: modelsPath,
        handler(_request, response, helpers) {
          try {
            helpers.sendJson(response, 200, runtime.codexModelCatalog());
          } catch (error) {
            helpers.sendJson(response, 503, errorBody(error));
          }
        }
      });
    }
    ctx.logger.info("CUHK backend registered; public routing owned by CCR, model catalog served in Codex schema");
  }
};
