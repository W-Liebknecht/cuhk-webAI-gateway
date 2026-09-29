"use strict";

const crypto = require("node:crypto");
const { ProtocolError } = require("./errors.cjs");
const { parseToolCall } = require("./protocol.cjs");

const DECISION_VERSION = 1;
const DECISION_ENVELOPE = /^\s*<agent_decision>\s*([\s\S]*?)\s*<\/agent_decision>([\s\S]*)$/u;
const FENCED_DECISION = /^\s*```([a-zA-Z0-9_-]*)[ \t]*\r?\n([\s\S]*?)\r?\n```([\s\S]*)$/u;
const DECISION_FENCE_LANGUAGES = new Set(["cuhk-decision", "cuhk_decision", "agent_decision"]);
const MAX_REASON_CHARS = 2000;
const MAX_FEEDBACK_CHARS = 4000;
const MAX_EVIDENCE_ITEMS = 32;
const MAX_EVIDENCE_CHARS = 2000;

function decisionLanguage(profile = {}) {
  return ["glm", "deepseek", "kimi", "seed"].includes(profile.toolPromptStyle) ? "zh" : "en";
}

function boundedString(value, name, maximum, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ProtocolError(`Agent decision ${name} is required.`);
    return "";
  }
  if (typeof value !== "string") throw new ProtocolError(`Agent decision ${name} must be a string.`);
  const text = value.trim();
  if (required && !text) throw new ProtocolError(`Agent decision ${name} is required.`);
  if (text.length > maximum) throw new ProtocolError(`Agent decision ${name} is too long.`);
  return text;
}

function normalizeEvidence(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_ITEMS) {
    throw new ProtocolError(`Agent decision evidence must be an array of at most ${MAX_EVIDENCE_ITEMS} strings.`);
  }
  return value.map((item, index) => boundedString(item, `evidence[${index}]`, MAX_EVIDENCE_CHARS, true));
}

function parseDecisionJson(payload) {
  let value;
  try { value = JSON.parse(cleanDecisionPayload(payload)); }
  catch { throw new ProtocolError("Agent decision envelope contains invalid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolError("Agent decision envelope must contain a JSON object.");
  }
  if (value.version !== DECISION_VERSION) throw new ProtocolError(`Agent decision version must be ${DECISION_VERSION}.`);
  if (!["tool", "final", "blocked"].includes(value.decision)) {
    throw new ProtocolError("Agent decision must be tool, final, or blocked.");
  }
  return value;
}

function cleanDecisionPayload(payload) {
  // The school renderer occasionally leaks its internal argument wrapper at
  // the edge of an otherwise byte-preserved code block. Strip only that exact
  // outer artifact; never rewrite JSON content or command arguments.
  return String(payload)
    .trim()
    .replace(/^<arg_value>\s*/u, "")
    .replace(/\s*<\/arg_value>$/u, "");
}

function parseAgentDecision(text, tools, options = {}) {
  const raw = String(text || "");
  let payload;
  let trailing = "";
  const envelope = DECISION_ENVELOPE.exec(raw);
  if (envelope) {
    payload = envelope[1];
    trailing = envelope[2].trim();
  } else {
    const fenced = FENCED_DECISION.exec(raw);
    if (fenced && isDecisionFence(fenced[1], fenced[2])) {
      payload = fenced[2];
      trailing = fenced[3].trim();
    }
  }
  if (payload === undefined) {
    if (/<\/?agent(?:\\)?_decision>|```(?:cuhk-decision|cuhk_decision|agent_decision)/u.test(raw)) {
      throw new ProtocolError("Assistant produced a malformed AGENT DECISION PROTOCOL v1 envelope.");
    }
    return null;
  }

  const value = parseDecisionJson(payload);
  const reason = boundedString(value.reason, "reason", MAX_REASON_CHARS, true);
  const gatewayFeedback = boundedString(value.gateway_feedback, "gateway_feedback", MAX_FEEDBACK_CHARS);
  const evidence = normalizeEvidence(value.evidence);

  if (value.decision === "tool") {
    if (trailing) throw new ProtocolError("A tool decision cannot include trailing answer text.");
    if (typeof value.name !== "string" || !value.name.trim()) throw new ProtocolError("A tool decision requires name.");
    if (!value.arguments || typeof value.arguments !== "object" || Array.isArray(value.arguments)) {
      throw new ProtocolError("A tool decision requires an arguments object.");
    }
    const parsed = parseToolCall(`<tool_call>${JSON.stringify({ name: value.name, arguments: value.arguments })}</tool_call>`, tools, options);
    return { kind: "tool", parsed, reason, evidence, gatewayFeedback, explicit: true };
  }

  const answer = trailing || boundedString(value.answer, "answer", 256 * 1024, true);
  if (!answer) throw new ProtocolError(`A ${value.decision} decision requires final answer text after the envelope or in answer.`);
  if (value.decision === "blocked" && value.requires_user !== undefined && typeof value.requires_user !== "boolean") {
    throw new ProtocolError("A blocked decision requires_user must be boolean when provided.");
  }
  return {
    kind: value.decision,
    answer,
    reason,
    evidence,
    gatewayFeedback,
    requiresUser: value.decision === "blocked" ? value.requires_user !== false : false,
    explicit: true
  };
}

function isDecisionFence(language, payload) {
  if (DECISION_FENCE_LANGUAGES.has(String(language || "").toLowerCase())) return true;
  // The CUHK renderer sometimes rewrites an unknown info string to `text`.
  // Accept a generic whole-response fence only when its JSON positively
  // identifies this protocol; legacy {name, arguments} blocks remain tools.
  try {
    const value = JSON.parse(cleanDecisionPayload(payload).replace(/\\_/gu, "_"));
    return value?.version === DECISION_VERSION && ["tool", "final", "blocked"].includes(value?.decision);
  } catch {
    return false;
  }
}

function actionFingerprint(parsed) {
  if (!parsed) return null;
  return crypto.createHash("sha256")
    .update(`${parsed.tool.protocolName}\u0000${parsed.argumentJson}`)
    .digest("hex")
    .slice(0, 24);
}

function decisionProtocolPrompt(profile = {}, options = {}) {
  const language = decisionLanguage(profile);
  const tools = Array.isArray(options.tools) ? options.tools : [];
  const toolNames = tools.map((tool) => tool.name || tool.protocolName).filter(Boolean).join(", ") || "(none)";
  if (language === "zh") {
    return [
      "AGENT DECISION PROTOCOL v1（主协议）",
      "Gateway 掌握工具是否真实执行、exit_code、pending 状态和安全边界；你掌握用户目标的语义、下一步行动及任务是否完成。双方不得越权。",
      "每次回复先独立判断当前状态，再只选择 tool、final、blocked 之一。Gateway 的 CONTROL/REPAIR 是可质疑的诊断，不是必须继续执行的命令；若任务已完成，必须坚持 final，不得为了迎合 Gateway 编造新操作。",
      "tool：回复只能包含以下代码块，不得有前后文字。必须保留代码围栏，避免网页 Markdown 改写命令中的 $、反斜杠或下划线：",
      "```cuhk-decision",
      '{"version":1,"decision":"tool","name":"工具名","arguments":{},"reason":"仍需该操作的原因"}',
      "```",
      "final：先输出决策代码块，随后直接写给用户的最终答复；最终答复中的命令、代码块和手动步骤只是文档，不会被 Gateway 当工具执行：",
      "```cuhk-decision",
      '{"version":1,"decision":"final","reason":"goal_satisfied","evidence":["真实证据"],"gateway_feedback":"如 Gateway 判断错误可在此指出"}',
      "```",
      "<给用户的最终答复，可包含 Markdown/代码块>",
      "blocked：无法安全继续或必须由用户决定时使用，并在决策代码块后解释：",
      "```cuhk-decision",
      '{"version":1,"decision":"blocked","reason":"阻塞原因","requires_user":true,"evidence":[]}',
      "```",
      "<给用户的阻塞说明>",
      `可用工具：${toolNames}`,
      "兼容说明：旧 TOOL PROTOCOL JSON/PowerShell 仍可解析，但上述决策协议优先且能避免误判。"
    ].join("\n");
  }
  return [
    "AGENT DECISION PROTOCOL v1 (primary protocol)",
    "The Gateway owns execution facts, exit codes, pending state, validation, and safety boundaries. You own task meaning, the next semantic action, and whether the user's goal is complete. Neither side may override the other's authority.",
    "Independently choose exactly one decision: tool, final, or blocked. A Gateway CONTROL/REPAIR message is a challenge you may reject, not an order to invent more work. If the goal is complete, insist on final.",
    "tool (the fenced block must be the whole reply; keep the fence so web Markdown cannot rewrite $, backslashes, or underscores in arguments):",
    "```cuhk-decision",
    '{"version":1,"decision":"tool","name":"tool_name","arguments":{},"reason":"why this operation is still needed"}',
    "```",
    "final (write the user-facing answer after the decision block; code blocks there are documentation and are never executed):",
    "```cuhk-decision",
    '{"version":1,"decision":"final","reason":"goal_satisfied","evidence":["real evidence"],"gateway_feedback":"optional correction of a Gateway assumption"}',
    "```",
    "<user-facing final answer, Markdown allowed>",
    "blocked (explain after the decision block):",
    "```cuhk-decision",
    '{"version":1,"decision":"blocked","reason":"why progress is unsafe or impossible","requires_user":true,"evidence":[]}',
    "```",
    "<user-facing blocker explanation>",
    `Available tools: ${toolNames}`,
    "Legacy TOOL PROTOCOL JSON/script requests remain accepted for compatibility, but this decision protocol takes precedence."
  ].join("\n");
}

function decisionProtocolReminder(profile = {}) {
  return decisionLanguage(profile) === "zh"
    ? [
      "AGENT DECISION PROTOCOL v1 REMINDER",
      "独立选择 tool / final / blocked。Gateway 控制消息可被纠正；任务完成就选择 final，不要追加终检。",
      '格式：先输出 ```cuhk-decision 代码块，块内是决策 JSON；final/blocked 后可接用户答复，tool 后不得有其他文字。必须保留代码围栏。'
    ].join("\n")
    : [
      "AGENT DECISION PROTOCOL v1 REMINDER",
      "Independently choose tool, final, or blocked. You may correct Gateway control assumptions; choose final when the goal is complete instead of inventing verification work.",
      'Format: emit a ```cuhk-decision fenced JSON block first. A final/blocked block may be followed by the user answer; a tool block must stand alone. Keep the fence.'
    ].join("\n");
}

module.exports = {
  DECISION_VERSION,
  actionFingerprint,
  decisionLanguage,
  decisionProtocolPrompt,
  decisionProtocolReminder,
  parseAgentDecision
};
