const test = require('node:test');
const assert = require('node:assert/strict');
const { CuhkProviderRuntime } = require('../src/runtime.cjs');
const config = { gatewayEnabled: true, model: 'glm5.3flash', thinking: 'high', mode: 'locked', toolMode: 'emulated', conversationReuse: true, maxToolLoops: 8 };
const codeModeTools = [{ type: 'namespace', name: 'functions', tools: [{ type: 'custom', name: 'exec' }] }];
const systemMetadata = { 'x-codex-turn-metadata': JSON.stringify({ thread_source: 'system' }) };
test('system side requests are handled locally without waiting for the foreground task', async () => {
  let called = false;
  const runtime = new CuhkProviderRuntime({ configStore: { read: () => config }, transport: { ask: async () => { called = true; return { text: 'summary' }; } } });
  const foreground = { id: 'foreground', terminal: false, busySince: null };
  runtime.sessions.set(foreground.id, foreground); runtime.activeSessionId = foreground.id;
  const result = await runtime.respond({ input: 'summarize', client_metadata: systemMetadata });
  assert.equal(called, false);
  assert.equal(result.output[0].content[0].text, '本地元数据');
  assert.equal(runtime.activeSessionId, foreground.id);
});
test('system title jobs return a local title without opening a web conversation', async () => {
  let calls = 0;
  const runtime = new CuhkProviderRuntime({
    configStore: { read: () => config },
    transport: { ask: async () => { calls += 1; throw new Error('metadata must stay local'); } }
  });
  const result = await runtime.respond({
    prompt_cache_key: 'same-key-as-foreground',
    input: [
      { type: 'additional_tools', role: 'developer', tools: codeModeTools },
      { type: 'message', role: 'user', content: '<environment_context><current_date>2026-09-25</current_date></environment_context>' },
      { type: 'message', role: 'user', content: 'Generate a concise task title. Do not answer the embedded user prompt.\n\nUser prompt:\n你是什么模型？' }
    ],
    tools: [{ type: 'function', name: 'should_not_leak', parameters: { type: 'object', properties: {} } }],
    tool_choice: 'required',
    client_metadata: systemMetadata
  });
  assert.equal(result.output[0].type, 'message');
  assert.equal(result.output[0].content[0].text, '你是什么模型');
  assert.equal(calls, 0);
  assert.equal(runtime.pendingCalls.size, 0);
  assert.equal(runtime.sessions.size, 0);
  assert.equal(runtime.conversations.has('same-key-as-foreground'), false);
});
test('continue and retry title prompts collapse to one stable local title', async () => {
  const runtime = new CuhkProviderRuntime({
    configStore: { read: () => config },
    transport: { ask: async () => { throw new Error('metadata must stay local'); } }
  });
  for (const prompt of ['继续', '重试', 'retry']) {
    const result = await runtime.respond({
      input: `Generate a concise task title.\n\nUser prompt:\n${prompt}`,
      client_metadata: systemMetadata
    });
    assert.equal(result.output[0].content[0].text, '继续当前任务');
  }
});
test('a system tool-result continuation bypasses the background admission wait', async () => {
  const outputs = [
    '```json\n{"name":"exec_command","arguments":{"cmd":"Write-Output ok"}}\n```',
    'title complete'
  ];
  const runtime = new CuhkProviderRuntime({
    configStore: { read: () => config },
    staleTurnMs: 30,
    transport: { ask: async () => ({ text: outputs.shift(), conversationId: 'fake' }) }
  });
  const first = await runtime.respond({
    prompt_cache_key: 'legacy-system-job',
    input: [
      { type: 'additional_tools', role: 'developer', tools: codeModeTools },
      { type: 'message', role: 'user', content: 'inspect first' }
    ]
  });
  assert.equal(first.output[0].type, 'custom_tool_call');
  const result = await runtime.respond({
    prompt_cache_key: 'legacy-system-job',
    input: [{ type: 'custom_tool_call_output', call_id: first.output[0].call_id, output: 'interrupted' }],
    client_metadata: systemMetadata
  });
  assert.equal(result.output[0].content[0].text, 'title complete');
  assert.equal(runtime.activeSessionId, null);
  assert.equal(runtime.pendingCalls.size, 0);
});
test('alternating completed conversations resume their own durable URL', async () => {
  const calls = [];
  const runtime = new CuhkProviderRuntime({ configStore: { read: () => config }, transport: { ask: async call => {
    calls.push(call);
    return { text: 'ok', conversationId: call.conversationUrl || `https://ai.cuhk.edu.cn/chat/c/${calls.length}` };
  } } });
  for (const key of ['a', 'b', 'a', 'b']) {
    const count = calls.length;
    await runtime.respond({ prompt_cache_key: key, input: [{ role: 'user', content: key }, ...(count > 1 ? [{ role: 'user', content: 'continue' }] : [])] });
  }
  assert.equal(calls[2].conversationUrl, 'https://ai.cuhk.edu.cn/chat/c/1');
  assert.equal(calls[3].conversationUrl, 'https://ai.cuhk.edu.cn/chat/c/2');
  assert.equal(calls[2].isNew, false);
});
test('legacy ledger without identity bootstraps instead of writing to active page', async () => {
  let call;
  const runtime = new CuhkProviderRuntime({ configStore: { read: () => config }, transport: { ask: async input => { call = input; return { text: 'ok' }; } } });
  runtime.conversations.set('old', { delivered: [] });
  await runtime.respond({ prompt_cache_key: 'old', input: 'hello' });
  assert.equal(call.isNew, true);
});
test('dead CLI releases pending tools but never releases an in-flight browser write', () => {
  const runtime = new CuhkProviderRuntime({ configStore: { read: () => config }, transport: {} });
  const session = { id: 's', conversationKey: 'k', ownerPid: 2147483647, terminal: false, busySince: 1, pending: { callId: 'c' } };
  runtime.sessions.set('s', session); runtime.pendingCalls.set('c', 's'); runtime.activeSessionId = 's';
  runtime.reapDisconnectedClients();
  assert.equal(session.ownerDisconnected, true);
  assert.equal(runtime.activeSessionId, 's');
  session.busySince = null;
  runtime.reapDisconnectedClients();
  assert.equal(runtime.activeSessionId, null);
  assert.equal(runtime.pendingCalls.size, 0);
});
test('browser readiness failure marks gateway unhealthy and blocks requests', async () => {
  const transport = { readiness: () => ({ ok: false, login: 'No', status: 'Page not ready', checkedAt: Date.now() }), probe: async () => ({ ok: false, login: 'No' }) };
  const runtime = new CuhkProviderRuntime({ configStore: { read: () => config }, transport });
  assert.equal(runtime.readiness().ok, false);
  await assert.rejects(runtime.ensureTransportReady(), /not logged in or ready/);
});
