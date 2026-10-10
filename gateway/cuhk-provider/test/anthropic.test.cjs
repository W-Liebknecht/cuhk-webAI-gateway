"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { toResponses, toMessage, messageEvents, sessionKey, estimateTokens } = require("../src/anthropic.cjs");
const { normalizeTools, compileCatalog, parseToolCall, validateValue } = require("../src/protocol.cjs");
const { CuhkProviderRuntime } = require("../src/runtime.cjs");
const { MODEL_THINKING } = require("../src/config.cjs");
const nativeTools = require("./fixtures/claude-native-tools.json");
const tool = { name: "Write", description: "Write a file", input_schema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object",
  properties: { file_path: { type: "string" }, content: { type: "string" } }, required: ["file_path", "content"], additionalProperties: false } };
function body(overrides = {}) { return { model: "cuhk-gateway", max_tokens: 1000, messages: [{ role: "user", content: "write proof" }],
  metadata: { user_id: JSON.stringify({ session_id: "test-claude" }) }, tools: [tool], ...overrides }; }
function runtime(outputs, model = "qwen3.8-27b") {
  const calls = [];
  const config = { gatewayEnabled: true, model, thinking: MODEL_THINKING[model][0] || null, mode: "locked", toolMode: "emulated", conversationReuse: true, maxToolLoops: 8 };
  const instance = new CuhkProviderRuntime({ configStore: { read: () => config }, transport: { ask: async call => {
    calls.push(call); assert.ok(outputs.length, "unexpected extra web turn");
    return { text: outputs.shift(), conversationId: call.conversationUrl || "https://ai.cuhk.edu.cn/chat/c/fixture" };
  } } });
  return { instance, calls, config };
}

test("real interactive Claude tool catalog compiles including AskUserQuestion and SendMessage", () => {
  const tools = normalizeTools(toResponses(body({ tools: nativeTools })).tools);
  assert.equal(tools.length, nativeTools.length);
  assert.ok(tools.some(t => t.protocolName === "AskUserQuestion"));
  assert.ok(tools.some(t => t.protocolName === "SendMessage"));
  assert.doesNotThrow(() => compileCatalog(tools));
});

test("interactive title request is local metadata and cannot alter the active Claude task", async () => {
  const { instance, calls } = runtime(['<tool_call>{"name":"Write","arguments":{"file_path":"proof","content":"ok"}}</tool_call>']);
  await instance.respond(toResponses(body()));
  const active = instance.sessions.get(instance.activeSessionId);
  const title = body({ tools: [], system: "You are naming a coding session so the user can pick it out of a long list of sessions.",
    messages: [{ role: "user", content: [{ type: "text", text: "<session>Repair gateway tools</session>\nWrite the title in the predominant language." }] }] });
  const request = toResponses(title);
  assert.equal(request.client_metadata.cuhk_auxiliary, "session-title");
  const result = toMessage(await instance.respond(request), title.model);
  assert.equal(result.content[0].text, "Repair gateway tools");
  assert.equal(calls.length, 1); assert.equal(instance.pendingCalls.size, 1);
  assert.equal(active.queuedMessages?.length || 0, 0);
  assert.equal(toResponses(body({ tools: [], messages: title.messages })).client_metadata.cuhk_auxiliary, undefined);
});

test("native object keys, dynamic values, allOf and URI constraints remain enforced", () => {
  const schema = { type: "object", propertyNames: { pattern: "^[a-z]+$" },
    additionalProperties: { type: "string", allOf: [{ pattern: "^https:" }, { format: "uri" }] } };
  normalizeTools([{ type: "function", name: "Native", parameters: schema }]);
  assert.equal(validateValue({ link: "https://example.com" }, schema, "$", 0), null);
  assert.match(validateValue({ "bad-key": "https://example.com" }, schema, "$", 0), /property name.*pattern/);
  assert.match(validateValue({ link: 42 }, schema, "$", 0), /string/);
  assert.match(validateValue({ link: "relative/path" }, schema, "$", 0), /pattern/);
  assert.match(validateValue("relative/path", { type: "string", format: "uri" }, "$", 0), /URI/);
  assert.match(validateValue("https://example.com/a b", { type: "string", format: "uri" }, "$", 0), /URI/);
  assert.match(validateValue("https://example.com/%ZZ", { type: "string", format: "uri" }, "$", 0), /URI/);
  assert.equal(validateValue("hello", { type: "string", allOf: [{ properties: { x: { type: "string" } } }] }, "$", 0), null);
  for (const type of ["number", "integer", "boolean", "null"]) {
    assert.ok(validateValue("wrong-type", { type }, "$", 0), `${type} must reject a string`);
  }
  const catalog = compileCatalog(normalizeTools([{ type: "function", name: "Native", parameters: schema }])).prompt;
  assert.match(catalog, /propertyNames/); assert.match(catalog, /allOf/); assert.match(catalog, /uri/);
});

test("Messages translates system, replayed thinking, images, tool errors and following user text in order", () => {
  const result = toResponses(body({ system: [{ type: "text", text: "system" }], messages: [
    { role: "assistant", content: [{ type: "thinking", thinking: "private", signature: "signed" }, { type: "tool_use", id: "call", name: "Write", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call", is_error: true, content: [{ type: "text", text: "denied" }] },
      { type: "text", text: "retry" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } }] }
  ] }));
  assert.equal(result.input[0].role, "system");
  assert.equal(result.input[1].type, "function_call");
  assert.match(result.input[2].output, /tool execution error.*\ndenied/);
  assert.equal(result.input[3].content[1].image_url, "data:image/png;base64,AQID");
  assert.equal(result.prompt_cache_key, "claude:test-claude");
});
test("only actual session IDs are used, account identity never becomes a session", () => {
  assert.equal(sessionKey({ user_id: "account-only" }), null);
  assert.equal(sessionKey({ user_id: 'user_device_account_a_session_12345678-1234-1234-1234-123456789abc' }), "claude:12345678-1234-1234-1234-123456789abc");
  assert.equal(sessionKey({ user_id: '{"account_uuid":"shared"}' }), null);
});
test("all Anthropic tool choice modes map without enabling parallel calls", () => {
  for (const [type, expected] of [["auto", "auto"], ["none", "none"], ["any", "required"]]) assert.equal(toResponses(body({ tool_choice: { type } })).tool_choice, expected);
  assert.deepEqual(toResponses(body({ tool_choice: { type: "tool", name: "Write", disable_parallel_tool_use: true } })).tool_choice, { type: "function", name: "Write" });
});
test("token count is local and does not require max_tokens", () => {
  const request = body(); delete request.max_tokens;
  assert.ok(estimateTokens(request).input_tokens > 0);
});
test("unsupported content/tools fail explicitly rather than disappear", () => {
  for (const change of [{ tools: [{ type: "web_search_20250305" }] }, { messages: [{ role: "user", content: [{ type: "document" }] }] },
    { tool_choice: { type: "parallel" } }, { max_tokens: 0 }, { messages: [] }]) assert.throws(() => toResponses(body(change)));
});
test("Claude schema annotations and enforced pattern/exclusive bounds compile", () => {
  const schema = { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: {
    limit: { type: "integer", exclusiveMinimum: 0, exclusiveMaximum: 3 }, id: { type: "string", pattern: "^wf_[a-z]{2}$" }
  }, required: ["limit", "id"], additionalProperties: false };
  const tools = normalizeTools([{ type: "function", name: "Read", parameters: schema }]);
  assert.match(compileCatalog(tools).prompt, /exclusiveMinimum/);
  assert.equal(validateValue({ limit: 1, id: "wf_ab" }, schema, "$", 0), null);
  assert.match(validateValue({ limit: 0, id: "wf_ab" }, schema, "$", 0), /exclusive minimum/);
  assert.match(validateValue({ limit: 3, id: "wf_ab" }, schema, "$", 0), /exclusive maximum/);
  assert.match(validateValue({ limit: 1, id: "bad" }, schema, "$", 0), /pattern/);
});

for (const model of Object.keys(MODEL_THINKING)) {
  test(`${model}: native tool_use, full-history result and final reuse one conversation`, async () => {
    const { instance, calls } = runtime(['<tool_call>{"name":"Write","arguments":{"file_path":"proof.txt","content":"ok"}}</tool_call>', "done"], model);
    const first = toMessage(await instance.respond(toResponses(body())), "cuhk-gateway");
    assert.equal(first.stop_reason, "tool_use");
    assert.equal(first.content[0].name, "Write");
    const second = body({ messages: [...body().messages, { role: "assistant", content: first.content },
      { role: "user", content: [{ type: "tool_result", tool_use_id: first.content[0].id, content: "File written successfully" }] }] });
    const final = toMessage(await instance.respond(toResponses(second)), "cuhk-gateway");
    assert.equal(final.stop_reason, "end_turn");
    assert.equal(final.content[0].text, "done");
    assert.equal(calls[1].isNew, false);
    assert.equal(calls[1].conversationUrl, calls[0].conversationUrl || "https://ai.cuhk.edu.cn/chat/c/fixture");
    assert.match(calls[1].prompt, /File written successfully/);
    assert.equal(instance.pendingCalls.size, 0);
  });
}
test("SSE text/tool block lifecycle is consumable without Responses DONE marker", () => {
  const message = { id: "msg", type: "message", role: "assistant", model: "local", content: [
    { type: "text", text: "hi" }, { type: "tool_use", id: "call", name: "Write", input: { content: "a\\\"\n中文" } }],
    stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } };
  const events = messageEvents(message);
  assert.deepEqual(events.map(e => e.type), ["message_start", "content_block_start", "content_block_delta", "content_block_stop",
    "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]);
  assert.deepEqual(JSON.parse(events[5].delta.partial_json), message.content[1].input);
  assert.deepEqual(events[4].content_block.input, {});
});

test("Claude usage converts Codex's calibrated footer to the 100k context display scale", () => {
  for (const [input, expected] of [[12000, 0], [53500, 50000], [95000, 100000]]) {
    const message = toMessage({ id: "resp_usage", output: [{ type: "message", content: [{ text: "ok" }] }],
      usage: { input_tokens: input, output_tokens: 0 } }, "cuhk-gateway");
    assert.equal(message.usage.input_tokens, expected);
  }
});
test("GLM PowerShell fallback uses encoded PowerShell through Claude Bash, shell fences remain shell", () => {
  const tools = normalizeTools([{ type: "function", name: "Bash", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"], additionalProperties: false } }]);
  const result = parseToolCall('```powershell\nWrite-Output "中文 $literal"\n```', tools, { style: "glm" });
  const encoded = result.arguments.command.split(" ").at(-1);
  assert.equal(Buffer.from(encoded, "base64").toString("utf16le"), 'Write-Output "中文 $literal"');
  assert.equal(parseToolCall('```bash\nprintf ok\n```', tools, { style: "glm" }).arguments.command, "printf ok");
  assert.equal(parseToolCall('```powershell\nWrite-Output ok\n```', [], { style: "glm" }), null);
});
test("Messages retries reuse response/call IDs without duplicate browser execution", async () => {
  const { instance, calls } = runtime(['<tool_call>{"name":"Write","arguments":{"file_path":"proof","content":"ok"}}</tool_call>', "done"]);
  const request = toResponses(body());
  const [a, b] = await Promise.all([instance.respond(request), instance.respond(request)]);
  assert.equal(a.output[0].call_id, b.output[0].call_id); assert.equal(calls.length, 1);
  const result = toResponses(body({ messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: a.output[0].call_id, content: "ok" }] }] }));
  await instance.respond(result); await instance.respond(result);
  assert.equal(calls.length, 2);
});
test("wrong result ID is rejected before model and errors remain visible", async () => {
  const { instance, calls } = runtime(['<tool_call>{"name":"Write","arguments":{"file_path":"proof","content":"ok"}}</tool_call>', "blocked by client"]);
  const first = await instance.respond(toResponses(body()));
  await assert.rejects(instance.respond(toResponses(body({ messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "wrong", content: "ok" }] }] }))), /Unknown|unknown/);
  const request = body({ messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: first.output[0].call_id, is_error: true, content: "Permission denied" }] }] });
  await instance.respond(toResponses(request)); assert.match(calls[1].prompt, /tool execution error/);
});
test("completed Claude turns send only new user text, catalog changes refresh", async () => {
  const { instance, calls } = runtime(["one", "two", "three"]);
  await instance.respond(toResponses(body()));
  const messages = [...body().messages, { role: "assistant", content: "one" }, { role: "user", content: "second turn" }];
  await instance.respond(toResponses(body({ messages })));
  assert.equal(calls[1].isNew, false); assert.match(calls[1].prompt, /second turn/); assert.doesNotMatch(calls[1].prompt, /write proof/);
  await instance.respond(toResponses(body({ messages: [...messages, { role: "user", content: "third turn" }], tools: [{ ...tool, description: "Changed catalog" }] })));
  assert.match(calls[2].prompt, /Changed catalog/);
});

test("Claude Markdown environment survives compact model prompts", async () => {
  const { instance, calls } = runtime(["ok"]);
  await instance.respond(toResponses(body({ system: "Host Claude persona should be compacted", messages: [
    { role: "system", content: "# Environment\n - Primary working directory: D:\\Projects\\项目 空格\n - Shell: bash\nYou are Claude." },
    { role: "user", content: "inspect this project" }
  ] })));
  assert.match(calls[0].prompt, /cwd: D:\\Projects\\项目 空格; shell: bash/);
  assert.doesNotMatch(calls[0].prompt, /You are Claude/);
});
test("cross-session result rejection and size guard leave the pending call intact", async () => {
  const { instance, calls } = runtime(['<tool_call>{"name":"Write","arguments":{"file_path":"proof","content":"ok"}}</tool_call>', "done"]);
  const first = await instance.respond(toResponses(body()));
  const content = [{ type: "tool_result", tool_use_id: first.output[0].call_id, content: "ok" }];
  await assert.rejects(instance.respond(toResponses(body({ metadata: { user_id: '{"session_id":"other"}' }, messages: [{ role: "user", content }] }))), /another conversation/);
  await assert.rejects(instance.respond(toResponses(body({ messages: [{ role: "user", content: [{ ...content[0], content: "x".repeat(256 * 1024 + 1) }] }] }))), /too large/);
  assert.equal(calls.length, 1); assert.equal(instance.pendingCalls.size, 1);
  await instance.respond(toResponses(body({ messages: [{ role: "user", content }] })));
  assert.equal(instance.pendingCalls.size, 0);
});
test("images route away from Qwen/GLM and continuation retains the image model", async () => {
  const { instance, calls } = runtime(['<tool_call>{"name":"Write","arguments":{"file_path":"proof","content":"ok"}}</tool_call>', "done"], "glm5.3flash");
  const messages = [{ role: "user", content: [{ type: "text", text: "inspect image" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } }] }];
  const first = await instance.respond(toResponses(body({ messages })));
  await instance.respond(toResponses(body({ messages: [...messages, { role: "user", content: [{ type: "tool_result", tool_use_id: first.output[0].call_id, content: "ok" }] }] })));
  assert.deepEqual(calls.map(c => c.model), ["gpt5.6sol", "gpt5.6sol"]);
  assert.equal(calls[0].images.length, 1);
});
test("canceled Claude owner abandons pending tools, next session bootstraps safely", async () => {
  const { instance, calls } = runtime(['<tool_call>{"name":"Write","arguments":{"file_path":"proof","content":"ok"}}</tool_call>', "next"]);
  const request = toResponses(body(), { "x-cuhk-owner-pid": "2147483647" });
  await instance.respond(request);
  instance.reapDisconnectedClients();
  assert.equal(instance.pendingCalls.size, 0); assert.equal(instance.activeSessionId, null);
  await instance.respond(toResponses(body({ metadata: { user_id: '{"session_id":"next"}' } })));
  assert.equal(calls[1].isNew, true);
});
