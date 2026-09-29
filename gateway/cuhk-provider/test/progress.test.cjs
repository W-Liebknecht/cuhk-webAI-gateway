"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { CuhkProviderRuntime } = require("../src/runtime.cjs");
const { OpenCliTransport } = require("../src/transport.cjs");
const codeMode = [{ type: "namespace", name: "functions", tools: [{ type: "custom", name: "exec" }] }];
const message = content => ({ role: "user", content });
const call = (name, args) => `<tool_call>${JSON.stringify({ name, arguments: args })}</tool_call>`;
function setup(outputs) {
  const calls = [];
  const transport = { ask: async input => {
    calls.push(input);
    const value = outputs.shift();
    if (value instanceof Error) throw value;
    return { text: value };
  } };
  const runtime = new CuhkProviderRuntime({ transport, configStore: { read: () => ({ gatewayEnabled: true, model: "gpt5.6sol", thinking: "high", mode: "locked", conversationReuse: true, toolMode: "emulated", maxToolLoops: 8 }) } });
  const body = { prompt_cache_key: "progress-test", tools: codeMode };
  return { runtime, transport, calls, body };
}

test("exec metadata survives the bridge and write_stdin polls the same process", async () => {
  const { runtime, body, calls } = setup([call("functions__exec_command", { cmd: "test scan", yield_time_ms: 30000 }), "done"]);
  const first = await runtime.respond({ ...body, input: "scan fixture" });
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  let actualArgs, output;
  await new AsyncFunction("tools", "text", first.output[0].input)({ exec_command: async args => { actualArgs = args; return { session_id: 123, output: "scanned 12 entries" }; } }, result => { output = result; });
  assert.equal(actualArgs.yield_time_ms, 10000);
  assert.equal(output.session_id, 123);
  const second = await runtime.respond({ ...body, input: [{ type: "custom_tool_call_output", call_id: first.output[0].call_id, output: JSON.stringify(output) }] });
  assert.equal(calls.length, 1, "an unfinished process should be polled without another web turn");
  let pollOutput;
  await new AsyncFunction("tools", "text", second.output[0].input)({ write_stdin: async args => {
    assert.equal(args.session_id, 123);
    assert.equal(args.chars, "");
    assert.equal(args.yield_time_ms, 1000);
    return { exit_code: 0, output: "done" };
  } }, result => { pollOutput = result; });
  const final = await runtime.respond({ ...body, input: [{ type: "custom_tool_call_output", call_id: second.output[0].call_id, output: JSON.stringify(pollOutput) }] });
  assert.equal(final.output[0].content[0].text, "done");
  assert.equal(calls.length, 2);
});

test("progress queries during pending tools return immediately and preserve the pending call", async () => {
  const { runtime, body, calls } = setup([call("functions__exec_command", { cmd: "scan" }), "done"]);
  const first = await runtime.respond({ ...body, input: "scan" });
  for (let n = 0; n < 3; n++) {
    const status = await runtime.respond({ ...body, input: [message("scan"), message("进度如何？")] });
    assert.match(status.output[0].content[0].text, /等待.*结果/);
    assert.equal(runtime.pendingCalls.size, 1);
  }
  assert.equal(calls.length, 1);
  await runtime.respond({ ...body, input: [{ type: "custom_tool_call_output", call_id: first.output[0].call_id, output: "done" }] });
});

test("progress does not wait behind browser generation or replace its result", async () => {
  const { runtime, body, transport } = setup([]);
  let resolve;
  transport.ask = () => new Promise(done => { resolve = done; });
  const original = runtime.respond({ ...body, input: "think" });
  await new Promise(done => setImmediate(done));
  const status = await runtime.respond({ ...body, input: [message("think"), message("还在思考吗？")] });
  assert.match(status.output[0].content[0].text, /网页 AI 正在生成/);
  resolve({ text: "finished" });
  assert.equal((await original).output[0].content[0].text, "finished");
});

test("a user progress message after a pending tool result is consumed in the same task", async () => {
  const { runtime, body, calls } = setup([call("functions__exec_command", { cmd: "scan" }), "已扫描 12 个目录，扫描仍在进行。"]);
  const first = await runtime.respond({ ...body, input: [message("scan")] });
  const result = await runtime.respond({ ...body, input: [message("scan"), first.output[0], { type: "custom_tool_call_output", call_id: first.output[0].call_id, output: '{"session_id":123,"output":"12 entries"}' }, message("进度如何？")] });
  assert.match(result.output[0].content[0].text, /12/);
  assert.match(calls[1].prompt, /进度如何/);
  assert.match(calls[1].prompt, /tool_choice: none/);
  assert.equal(runtime.pendingCalls.size, 0);
});

test("supplementary input is queued while a tool is running and included with its result", async () => {
  const { runtime, body, calls } = setup([call("functions__exec_command", { cmd: "scan" }), "limited to the requested directory"]);
  const first = await runtime.respond({ ...body, input: [message("scan")] });
  const ack = await runtime.respond({ ...body, input: [message("scan"), message("只统计测试目录，请不要扫描其他地方")] });
  assert.match(ack.output[0].content[0].text, /已收到/);
  assert.equal(calls.length, 1);
  await runtime.respond({ ...body, input: [{ type: "custom_tool_call_output", call_id: first.output[0].call_id, output: "done" }] });
  assert.match(calls[1].prompt, /只统计测试目录/);
});

test("polls do not exhaust the eight operation budget", async () => {
  const outputs = [call("functions__exec_command", { cmd: "scan" }), "done"];
  const { runtime, body, calls } = setup(outputs);
  let response = await runtime.respond({ ...body, input: "scan" });
  for (let n = 0; n < 11; n++) {
    response = await runtime.respond({ ...body, input: [{ type: "custom_tool_call_output", call_id: response.output[0].call_id, output: JSON.stringify({ ...(n === 10 ? { exit_code: 0 } : { session_id: 123 }), output: `${n} entries` }) }] });
  }
  assert.equal(response.output[0].content[0].text, "done");
  assert.equal(calls.length, 2, "empty process polls must not create web turns");
});

test("the web transport allows long thought for up to 30 minutes by default", () => {
  assert.equal(new OpenCliTransport({ entryPath: __filename }).timeoutSeconds, 1800);
});

test("the web model is consulted again only after the real process exits", async () => {
  const { runtime, body, calls } = setup([call("functions__exec_command", { cmd: "scan" }), "verified done"]);
  const first = await runtime.respond({ ...body, input: "scan" });
  const second = await runtime.respond({ ...body, input: [{ type: "custom_tool_call_output", call_id: first.output[0].call_id, output: '{"session_id":123,"output":"started"}' }] });
  assert.match(second.output[0].input, /tools.write_stdin/);
  assert.match(second.output[0].input, /"session_id":123/);
  assert.equal(calls.length, 1);
  const final = await runtime.respond({ ...body, input: [{ type: "custom_tool_call_output", call_id: second.output[0].call_id, output: '{"exit_code":0,"output":"done"}' }] });
  assert.equal(final.output[0].content[0].text, "verified done");
  assert.equal(calls.length, 2);
});
