"use strict";

const crypto = require("node:crypto");
const { RequestError } = require("./errors.cjs");

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new RequestError("Message content must be text or an array of text parts.");
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") throw new RequestError("Invalid content part.");
    if (["input_text", "output_text", "text"].includes(part.type)) return String(part.text || "");
    throw new RequestError(`Unsupported content part: ${part.type}`);
  }).filter(Boolean).join("\n");
}

function imageSource(part) {
  const value = part.image_url ?? part.file_path ?? part.path;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && typeof value.url === "string" && value.url.trim()) return value.url.trim();
  throw new RequestError("input_image is missing image_url or a local path.");
}

function messageContent(content, role) {
  if (typeof content === "string") return { text: content, images: [] };
  if (!Array.isArray(content)) throw new RequestError("Message content must be text or an array of content parts.");
  const text = [];
  const images = [];
  for (const part of content) {
    if (typeof part === "string") { text.push(part); continue; }
    if (!part || typeof part !== "object") throw new RequestError("Invalid content part.");
    if (["input_text", "output_text", "text"].includes(part.type)) { text.push(String(part.text || "")); continue; }
    if (part.type === "input_image") {
      if (role !== "user") throw new RequestError("input_image is supported only in user messages.");
      images.push({ source: imageSource(part), detail: part.detail || null });
      continue;
    }
    throw new RequestError(`Unsupported content part: ${part.type}`);
  }
  if (images.length > 4) throw new RequestError("At most 4 images are supported in one user message.");
  return { text: text.filter(Boolean).join("\n"), images };
}

function parseInput(input) {
  if (typeof input === "string") return { history: [{ role: "user", text: input }], result: null, additionalTools: [] };
  if (!Array.isArray(input)) throw new RequestError("input must be a string or an array.");
  const history = [];
  const results = [];
  const allResults = [];
  const additionalTools = [];
  for (const item of input) {
    if (!item || typeof item !== "object") throw new RequestError("input items must be objects.");
    if (item.type === "additional_tools") {
      if (!Array.isArray(item.tools)) throw new RequestError("additional_tools must contain a tools array.");
      additionalTools.push(...item.tools);
      continue;
    }
    if (item.type === "function_call_output" || item.type === "custom_tool_call_output") {
      if (typeof item.call_id !== "string" || !item.call_id) throw new RequestError("Tool result is missing call_id.");
      const output = typeof item.output === "string" ? item.output : textFromContent(item.output);
      results.push({ callId: item.call_id, output });
      allResults.push({ callId: item.call_id, output });
      continue;
    }
    // Codex replays prior call items alongside the matching output. The pending
    // call is already held in runtime state and is verified by call_id.
    if (["function_call", "custom_tool_call", "reasoning"].includes(item.type)) continue;
    const role = typeof item.role === "string" ? item.role : item.type === "message" ? "user" : null;
    if (!role || !["system", "developer", "user", "assistant"].includes(role)) {
      throw new RequestError(`Unsupported input item: ${item.type || item.role}`);
    }
    const content = messageContent(item.content, role);
    if (role && (content.text || content.images.length)) {
      history.push({ role, text: content.text, images: content.images });
      // A user message after an output begins a new task. Earlier outputs are
      // replayed history, not submissions to the pending-tool state machine.
      if (role === "user") results.length = 0;
    }
  }
  return { history, result: results.length ? results[results.length - 1] : null, allResults, additionalTools };
}

function createTextResponse({ model, text, responseId = id("resp") }) {
  return {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model,
    output: [{
      id: id("msg"),
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [] }]
    }],
    parallel_tool_calls: false,
    usage: null
  };
}

function createToolResponse({ model, callId, tool, argumentsJson, argumentsValue, responseId = id("resp") }) {
  const namespace = tool.namespace ? { namespace: tool.namespace } : {};
  const output = tool.clientType === "code_mode_exec"
    ? [{ type: "custom_tool_call", id: id("ctc"), call_id: callId, name: tool.clientName, input: codeModeInput(tool.operation, argumentsValue), ...namespace }]
    : tool.clientType === "custom"
    ? [{ type: "custom_tool_call", id: id("ctc"), call_id: callId, name: tool.clientName, input: argumentsValue[tool.inputField], ...namespace }]
    : [{ type: "function_call", id: id("fc"), call_id: callId, name: tool.clientName, arguments: argumentsJson, status: "completed", ...namespace }];
  return {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model,
    output,
    parallel_tool_calls: false,
    usage: null
  };
}

function codeModeInput(operation, argumentsValue) {
  if (operation === "apply_patch") {
    return `const result = await tools.apply_patch(${JSON.stringify(argumentsValue.patch)}); text(result);`;
  }
  if (operation === "exec_command") {
    // Yield long commands promptly and retain the process metadata. The model
    // must poll session_id instead of launching the same scan a second time.
    const execArgs = {
      ...argumentsValue,
      login: false,
      yield_time_ms: Math.min(argumentsValue.yield_time_ms || 10000, 10000)
    };
    return `const result = await tools.exec_command(${JSON.stringify(execArgs)}); text(result);`;
  }
  if (operation === "write_stdin") {
    return `const result = await tools.write_stdin(${JSON.stringify({ ...argumentsValue, chars: "", yield_time_ms: 1000 })}); text(result);`;
  }
  throw new RequestError(`Unsupported code-mode operation: ${operation}`);
}

function responseEvents(response) {
  const sequence = [{ type: "response.created", sequence_number: 0, response: { ...response, status: "in_progress", output: [] } }];
  let sequenceNumber = 1;
  for (let outputIndex = 0; outputIndex < response.output.length; outputIndex += 1) {
    const item = response.output[outputIndex];
    const initialItem = { ...item, status: "in_progress" };
    if (item.type === "message") initialItem.content = [];
    if (item.type === "function_call") initialItem.arguments = "";
    if (item.type === "custom_tool_call") initialItem.input = "";
    sequence.push({ type: "response.output_item.added", sequence_number: sequenceNumber++, output_index: outputIndex, item: initialItem });
    if (item.type === "message") {
      const part = item.content[0];
      sequence.push({ type: "response.content_part.added", sequence_number: sequenceNumber++, item_id: item.id, output_index: outputIndex, content_index: 0, part: { ...part, text: "" } });
      sequence.push({ type: "response.output_text.delta", sequence_number: sequenceNumber++, item_id: item.id, output_index: outputIndex, content_index: 0, delta: part.text });
      sequence.push({ type: "response.output_text.done", sequence_number: sequenceNumber++, item_id: item.id, output_index: outputIndex, content_index: 0, text: part.text });
      sequence.push({ type: "response.content_part.done", sequence_number: sequenceNumber++, item_id: item.id, output_index: outputIndex, content_index: 0, part });
    } else if (item.type === "function_call") {
      sequence.push({ type: "response.function_call_arguments.delta", sequence_number: sequenceNumber++, item_id: item.id, output_index: outputIndex, delta: item.arguments });
      sequence.push({ type: "response.function_call_arguments.done", sequence_number: sequenceNumber++, item_id: item.id, output_index: outputIndex, arguments: item.arguments });
    } else if (item.type === "custom_tool_call") {
      sequence.push({ type: "response.custom_tool_call_input.delta", sequence_number: sequenceNumber++, item_id: item.id, output_index: outputIndex, delta: item.input });
      sequence.push({ type: "response.custom_tool_call_input.done", sequence_number: sequenceNumber++, item_id: item.id, output_index: outputIndex, input: item.input });
    }
    sequence.push({ type: "response.output_item.done", sequence_number: sequenceNumber++, output_index: outputIndex, item });
  }
  sequence.push({ type: "response.completed", sequence_number: sequenceNumber, response });
  return sequence;
}

module.exports = { createTextResponse, createToolResponse, id, parseInput, responseEvents };
