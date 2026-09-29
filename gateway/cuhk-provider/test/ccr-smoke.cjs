"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { cuhkProvider } = require("../src/ccr-registration.cjs");

const root = path.resolve(__dirname, "../../..");
const ccr = path.join(root, "research/claude-code-router");
const state = path.join(root, "gateway/host-state");
const live = process.argv.includes("--live");
const toolLive = process.argv.includes("--tool-live");
const smokeOverride = process.argv.includes("--smoke-config");
const token = crypto.randomBytes(24).toString("hex");
const api = "http://127.0.0.1:3459/api/ccr/rpc";
let hostLogs = "";

async function rpc(method, ...args) {
  const result = await fetch(api, {
    method: "POST", headers: { "content-type": "application/json", "x-ccr-web-auth": token },
    body: JSON.stringify({ method, args })
  });
  const json = await result.json();
  if (!json.ok) throw new Error(json.error?.message || `RPC ${method} failed`);
  return json.value;
}

async function main() {
  const child = spawn(process.execPath, [path.join(ccr, "packages/core/dist/main/server.js"), "--host", "127.0.0.1", "--port", "3459", "--no-gateway"], {
    cwd: ccr, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CCR_WEB_AUTH_TOKEN: token,
      CCR_INTERNAL_HOME_DIR: path.join(state, "home"),
      CCR_INTERNAL_APP_DATA_DIR: path.join(state, "appdata"),
      CCR_INTERNAL_USER_DATA_DIR: path.join(state, "data") }
  });
  child.stdout.on("data", chunk => { hostLogs += chunk; });
  child.stderr.on("data", chunk => { hostLogs += chunk; });
  try {
    let config;
    for (let n = 0; n < 80; n++) {
      try { config = await rpc("getConfig"); break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    assert.ok(config, "CCR management host did not start");
    config.HOST = config.gateway.host = config.gateway.coreHost = "127.0.0.1";
    config.PORT = config.gateway.port = 3460;
    config.gateway.corePort = 3461;
    config.APIKEY = token;
    config.profile.enabled = false;
    config.profile.profiles = [];
    config.Providers = [cuhkProvider()];
    config.plugins = [{ id: "cuhk-ai-provider", enabled: true,
      module: path.join(root, "gateway/cuhk-provider/index.cjs"),
      surfaces: { apps: false, gateway: true, provider: false },
      permissions: ["trusted-code", "gateway-routes", "http-backends"],
      config: { backendPort: 3462, configPath: smokeOverride ? path.join(__dirname, "smoke-config.json") : path.join(root, "config.json") }
    }];
    await rpc("saveConfig", config, { applyProfile: false });
    await rpc("startGateway");
    const status = await rpc("getGatewayStatus");
    assert.equal(status.state, "running", JSON.stringify(status));
    const saved = await rpc("getConfig");
    assert.equal(saved.Providers[0].name, "CUHK AI");

    // Compile CCR's own registry, without copying its selector implementation.
    const esbuild = require(path.join(ccr, "node_modules/esbuild"));
    const bundle = path.join(state, "model-registry.cjs");
    await esbuild.build({ absWorkingDir: ccr, entryPoints: [path.join(ccr, "packages/core/src/routing/model-registry.ts")],
      bundle: true, platform: "node", format: "cjs", outfile: bundle, logLevel: "silent" });
    const { ModelRegistry } = require(bundle);
    const resolved = new ModelRegistry(saved).resolve("CUHK AI/gpt-5.6-sol");
    assert.equal(resolved?.kind, "provider");
    assert.equal(resolved?.model, "gpt-5.6-sol");
    const headers = { authorization: `Bearer ${saved.APIKEY}`, "content-type": "application/json" };
    const catalogs = {};
    for (const endpoint of ["/models", "/v1/models"]) {
      const response = await fetch(`http://127.0.0.1:3460${endpoint}`, { headers });
      assert.equal(response.status, 200);
      catalogs[endpoint] = await response.json();
      assert.match(JSON.stringify(catalogs[endpoint]), /gpt-5\.6-sol/);
    }
    const report = { live, toolLive, smokeOverride, client: "HTTP Responses smoke harness (not Codex CLI)", provider: saved.Providers[0].name, selector: resolved.canonicalSelector, catalogs, status: status.state };
    console.log("CCR provider, model catalogs and native route selector verified.");
    if (live) {
      console.log("Sending one tools-free Responses smoke request to the CCR public endpoint.");
      const response = await fetch("http://127.0.0.1:3460/v1/responses", {
        method: "POST", headers,
        body: JSON.stringify({ model: "CUHK AI/gpt-5.6-sol", input: "Reply with exactly CUHK_CCR_TEXT_SMOKE_OK", stream: false }),
        signal: AbortSignal.timeout(240000)
      });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      const text = (result.output || []).flatMap(item => item.content || []).map(part => part.text || "").join("");
      assert.match(text.replace(/\\_/g, "_"), /CUHK_CCR_TEXT_SMOKE_OK/);
      report.response = result;
      console.log(`LIVE TEXT: ${text}`);
    }
    if (toolLive) {
      const requestedValue = `smoke${crypto.randomBytes(8).toString("hex")}`;
      let executions = 0;
      function echo({ value }) { executions++; return value; }
      const instructions = 'Call echo exactly once with the requested value. After its result, return only a JSON object with exactly two fields: echoed (the actual result value) and receipt (the receipt provided in the tool result). No Markdown or explanation.';
      const tools = [{ type: "function",
        name: "echo", description: "Echo one value",
        parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false }
      }];
      const toolResponse = await fetch("http://127.0.0.1:3460/v1/responses", {
        method: "POST", headers,
        body: JSON.stringify({ model: "CUHK AI/gpt-5.6-sol", instructions, input: `Echo this value: ${requestedValue}`, tools, tool_choice: "required", stream: false }),
        signal: AbortSignal.timeout(240000)
      });
      const toolResult = await toolResponse.json();
      assert.equal(toolResponse.status, 200, JSON.stringify(toolResult));
      const call = toolResult.output?.[0];
      assert.equal(call?.type, "function_call", JSON.stringify(toolResult));
      assert.equal(call.name, "echo");
      const args = JSON.parse(call.arguments);
      assert.deepEqual(args, { value: requestedValue });
      console.log(`LIVE TOOL CALL: ${call.name} ${call.arguments}`);
      const echoed = echo(args);
      const receipt = crypto.randomBytes(16).toString("hex");
      const output = JSON.stringify({ ok: true, name: call.name, call_id: call.call_id, value: echoed, receipt });
      const continuation = await fetch("http://127.0.0.1:3460/v1/responses", {
        method: "POST", headers,
        body: JSON.stringify({ model: "CUHK AI/gpt-5.6-sol", input: [{ type: "function_call_output", call_id: call.call_id, output }], tools, tool_choice: "none", stream: false }),
        signal: AbortSignal.timeout(240000)
      });
      const continuedResult = await continuation.json();
      assert.equal(continuation.status, 200, JSON.stringify(continuedResult));
      const continuedText = (continuedResult.output || []).flatMap(item => item.content || []).map(part => part.text || "").join("");
      assert.deepEqual(JSON.parse(continuedText), { echoed, receipt });
      assert.equal(executions, 1);
      report.tool = { executions, output: JSON.parse(output), response: toolResult, continuation: continuedResult };
      console.log(`LIVE TOOL CONTINUATION: ${continuedText}`);
    }
    fs.writeFileSync(path.join(state, toolLive ? "tool-smoke-report.json" : live ? "live-smoke-report.json" : "registry-report.json"), JSON.stringify(report, null, 2));
  } finally {
    try { await rpc("stopGateway"); } catch {}
    child.kill();
  }
}

main().catch(error => { console.error(error.message); console.error(hostLogs.replaceAll(token, "[redacted]")); process.exitCode = 1; });
