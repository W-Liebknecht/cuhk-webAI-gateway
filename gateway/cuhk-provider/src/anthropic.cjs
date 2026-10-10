"use strict";

// Anthropic is a wire adapter only: calls, validation, retries and browser
// identity remain owned by the same runtime as the Responses surface.
const { RequestError } = require("./errors.cjs");

function blocks(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) throw new RequestError("Messages content must be text or an array.");
  return content;
}

function sessionKey(metadata) {
  const value = metadata?.user_id;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed.session_id === "string" && parsed.session_id) return `claude:${parsed.session_id}`;
  } catch {}
  const legacy = /(?:^|_)session_([0-9a-f-]{36})$/i.exec(value);
  return legacy ? `claude:${legacy[1]}` : null;
}

function image(block) {
  const source = block.source;
  if (source?.type === "base64" && typeof source.data === "string" && /^image\//.test(source.media_type)) {
    return { type: "input_image", image_url: `data:${source.media_type};base64,${source.data}` };
  }
  if (source?.type === "url" && typeof source.url === "string") return { type: "input_image", image_url: source.url };
  throw new RequestError("Unsupported Anthropic image source.");
}

function toResponses(body, headers = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError("Messages request must be an object.");
  if (!Array.isArray(body.messages) || !body.messages.length) throw new RequestError("messages must be a nonempty array.");
  if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1) throw new RequestError("max_tokens must be a positive integer.");
  if (typeof body.model !== "string" || !body.model) throw new RequestError("model is required.");
  const input = [];
  if (body.system !== undefined) {
    const system = blocks(body.system);
    if (system.some(b => b?.type !== "text" || typeof b.text !== "string")) throw new RequestError("system only supports text blocks.");
    input.push({ role: "system", content: system.map(b => b.text).join("\n") });
  }
  for (const message of body.messages) {
    if (!["user", "assistant", "system"].includes(message?.role)) throw new RequestError("Unsupported Messages role.");
    let content = [];
    const flush = () => {
      if (content.length) input.push({ role: message.role, content });
      content = [];
    };
    for (const block of blocks(message.content)) {
      if (block?.type === "text" && typeof block.text === "string") {
        content.push({ type: message.role === "assistant" ? "output_text" : "input_text", text: block.text });
      } else if (block?.type === "image" && message.role === "user") content.push(image(block));
      else if (block?.type === "tool_use" && message.role === "assistant") {
        flush();
        if (!block.id || !block.name || !block.input || typeof block.input !== "object") throw new RequestError("Invalid tool_use block.");
        input.push({ type: "function_call", call_id: block.id, name: block.name, arguments: JSON.stringify(block.input) });
      } else if (block?.type === "tool_result" && message.role === "user") {
        flush();
        const result = blocks(block.content ?? "");
        if (result.some(b => b?.type !== "text" || typeof b.text !== "string")) throw new RequestError("tool_result only supports text blocks.");
        input.push({ type: "function_call_output", call_id: block.tool_use_id,
          output: (block.is_error ? "[tool execution error]\n" : "") + result.map(b => b.text).join("\n") });
      } else if (["thinking", "redacted_thinking"].includes(block?.type) && message.role === "assistant") {
        // Signed reasoning is replayed by Claude Code; never treat it as new input.
      } else throw new RequestError(`Unsupported Messages content block: ${block?.type}`);
    }
    flush();
  }
  if (body.tools !== undefined && !Array.isArray(body.tools)) throw new RequestError("tools must be an array.");
  const tools = (body.tools || []).map(tool => {
    if (tool?.type && tool.type !== "custom") throw new RequestError(`Unsupported Anthropic tool type: ${tool.type}`);
    if (!tool?.input_schema || typeof tool.input_schema !== "object") throw new RequestError("Tool input_schema is required.");
    return { type: "function", name: tool.name, description: tool.description, parameters: tool.input_schema };
  });
  let choice = "auto";
  if (body.tool_choice) {
    const kind = body.tool_choice.type;
    if (!["auto", "any", "none", "tool"].includes(kind)) throw new RequestError("Unsupported tool_choice.");
    choice = kind === "any" ? "required" : kind === "tool" ? { type: "function", name: body.tool_choice.name } : kind;
  }
  const owner = Number(headers["x-cuhk-owner-pid"]);
  // Claude's interactive title job reuses the foreground session ID. It is
  // disposable UI metadata, just like Codex's system title jobs, and must never
  // queue an instruction into the foreground task or consume the browser slot.
  const systemText = input.filter(item => item.role === "system").map(item => typeof item.content === "string" ? item.content : item.content.map(b => b.text).join("\n")).join("\n");
  const titleJob = !tools.length && /You are naming a coding session\b/.test(systemText)
    && body.messages.length === 1 && body.messages[0].role === "user"
    && blocks(body.messages[0].content).some(b => b.type === "text" && /<session>[\s\S]*<\/session>/.test(b.text));
  return { model: body.model, stream: body.stream, input, tools, tool_choice: choice,
    prompt_cache_key: sessionKey(body.metadata), client_metadata: {
      client: "claude-code", ...(titleJob ? { cuhk_auxiliary: "session-title" } : {}),
      ...(Number.isInteger(owner) && owner > 0 ? { cuhk_owner_pid: owner } : {})
    } };
}

function toMessage(response, model) {
  const content = response.output.map(item => {
    if (item.type === "function_call") return { type: "tool_use", id: item.call_id, name: item.name, input: JSON.parse(item.arguments) };
    if (item.type === "message") return { type: "text", text: item.content.map(p => p.text || "").join("") };
    throw new RequestError(`Cannot encode Responses item as Messages: ${item.type}`);
  });
  // Responses usage is calibrated for Codex's footer; Messages uses the plain
  // 100k display scale, still an estimate rather than upstream billed tokens.
  const input = response.usage ? Math.round(Math.max(0, response.usage.input_tokens - 12000) / 83000 * 100000) : 0;
  return { id: response.id.replace(/^resp_/, "msg_"), type: "message", role: "assistant", model,
    content, stop_reason: content.some(b => b.type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null,
    usage: { input_tokens: input, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
}

function messageEvents(message) {
  const events = [{ type: "message_start", message: { ...message, content: [], stop_reason: null, usage: { ...message.usage } } }];
  message.content.forEach((block, index) => {
    events.push({ type: "content_block_start", index, content_block: block.type === "tool_use" ? { ...block, input: {} } : { type: "text", text: "" } });
    events.push({ type: "content_block_delta", index, delta: block.type === "tool_use"
      ? { type: "input_json_delta", partial_json: JSON.stringify(block.input) }
      : { type: "text_delta", text: block.text } });
    events.push({ type: "content_block_stop", index });
  });
  events.push({ type: "message_delta", delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 0 } });
  events.push({ type: "message_stop" });
  return events;
}

function anthropicError(error) {
  return { type: "error", error: { type: error.status === 400 ? "invalid_request_error" : error.status === 503 ? "overloaded_error" : "api_error",
    message: error.message || "CUHK Gateway failed" } };
}

function estimateTokens(body) {
  toResponses({ ...body, max_tokens: body.max_tokens ?? 1 }); // never call the web
  return { input_tokens: Math.ceil(Buffer.byteLength(JSON.stringify({ system: body.system, messages: body.messages, tools: body.tools }), "utf8") / 3) };
}

module.exports = { toResponses, toMessage, messageEvents, sessionKey, anthropicError, estimateTokens };
