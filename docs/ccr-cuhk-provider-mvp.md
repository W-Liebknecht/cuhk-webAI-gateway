# CCR CUHK provider MVP

Status: accepted on 2026-09-17.

Implementation status (2026-09-17): MVP accepted for the current Codex CLI path. `../gateway/cuhk-provider` uses CCR native Providers, ModelRegistry, public routing and a registered local HTTP backend. Real Codex CLI 0.155 runs passed text, shell execution, full-history tool-result continuation and native file change through CUHK. Real HTTP echo continuation also passed with an execution-time random receipt. 26 gateway and 11 CUHK adapter tests pass. Durable multi-conversation recovery and production hardening remain deferred.

Implementation addendum (2026-09-19): GLM 5.3 Flash would narrate "the local client rejected every tool" instead of emitting the raw `<tool_call>` envelope. The protocol now also accepts **one whole-response fenced JSON block** tagged `json`, `text`, or `cuhk_tool_call` as an equivalent strict tool-request form, and treats that GLM refusal narrative as a malformed tool attempt eligible for the single repair turn. This is still whole-response-only parsing; mixed prose and JSON examples are not promoted to tool calls.


## Purpose

Deliver the smallest complete Codex coding-agent loop through the school AI before investing in production hardening. The first version must be useful end to end, but it is not expected to solve every protocol, adversarial-input, crash-recovery, attachment, or scaling problem.

The MVP is successful when Codex can use CCR as its base URL, obtain a response from the selected CUHK model, receive a standard tool call synthesized from the model's constrained text output, execute that tool under Codex's normal approval and sandbox rules, return the result, and continue the same CUHK conversation to another tool call or a final answer.

## Selected foundation

- `musistudio/claude-code-router` (CCR) is the host gateway and client integration framework. Reuse its Codex profile, OpenAI Responses surface, routing, configuration, plugin mechanism, logging, and `apply_patch` bridge.
- A CUHK CCR extension/provider is the main new runtime component. It connects CCR to OpenCLI rather than pretending that CUHK is an ordinary OpenAI-compatible HTTP provider.
- OpenCLI remains the only owner of the authenticated Chrome session and CUHK-specific browser transport.
- LiteLLM is a protocol-behavior and test-fixture reference. Do not add a full LiteLLM sidecar to the MVP or introduce a second session and streaming state machine.
- `vystartasv/toolcall-proxy` is a conceptual reference for text tool-call detection. Its broad text heuristics are not the CUHK protocol contract.

```text
Codex
  |
  | OpenAI Responses
  v
CCR gateway
  |
  | CUHK provider extension
  v
Tool protocol runtime <--> session state
  |
  | OpenCLI adapter
  v
Authenticated Chrome --> ai.cuhk.edu.cn
```

## Required MVP capabilities

### 1. CCR integration

- Run as a CCR gateway/provider extension, not as an independent second public proxy.
- Expose the CUHK models through CCR's model catalog while honoring the existing panel's locked model and thinking-level selection.
- Bind local control surfaces to loopback and do not expose browser credentials or raw session material.
- Pin the CCR revision used for the first implementation and cover the extension boundary with contract tests so an upstream CCR update cannot silently change behavior.

### 2. CUHK transport

- Use the existing OpenCLI session and adapter rather than a new browser controller.
- Start a new CUHK conversation for a new client task and continue that conversation for tool-result turns.
- Serialize turns within one CUHK conversation. The MVP does not need parallel requests inside a single conversation.
- Surface typed unavailable, authentication, timeout, empty-response, and upstream errors to CCR.
- Do not automatically resend a turn when delivery is uncertain.

### 3. Codex request subset

The first verified client is Codex through `POST /v1/responses`.

Support:

- `instructions`, ordered text input/history, `model`, `stream`, function tools, and the `apply_patch` custom tool after CCR adaptation;
- `tool_choice` values needed by Codex for `none`, automatic selection, required selection, and a named function where representable;
- `function_call_output` continuation matched by a Bridge-generated `call_id`;
- one pending tool call and one emitted tool call per model turn;
- sequential multi-step loops across multiple turns.

Reject unsupported tool types or request shapes with a clear client error rather than silently dropping them. Anthropic Messages and OpenAI Chat Completions remain target surfaces, but they are not release blockers for the first Codex vertical slice.

### 4. Tool catalog compiler

- Convert supported client tool definitions into a compact `TOOL PROTOCOL v1` prompt. Never forward the client `tools` array to CUHK as if it were a supported native field.
- Preserve tool name, purpose, required arguments, primitive/container types, enums, and the constraints needed for local validation.
- Send the full catalog when a CUHK conversation is created or its state is uncertain.
- Store a canonical catalog fingerprint with the CUHK session. When the catalog is unchanged, refer to the existing protocol and fingerprint instead of repeating the full catalog.
- If the catalog changes during the MVP, resend the full catalog. Added/removed/changed delta catalogs are a later optimization.
- Instruct the model to return either ordinary answer text or exactly one standalone envelope:

```text
<tool_call>
{"name":"tool_name","arguments":{}}
</tool_call>
```

### 5. Text tool-call parser and validation

- Treat a response as a tool call only when the completed assistant turn consists solely of one `tool_call` envelope plus whitespace.
- Do not promote JSON code blocks, Python-like calls, or tool-looking prose into calls.
- Require valid UTF-8 JSON, a registered tool name, and an arguments object.
- Validate arguments against the original client schema and enforce basic count, nesting, and byte limits.
- Generate `call_id` inside the provider runtime; ignore any model-supplied identifier.
- On malformed output, allow at most one explicit protocol-repair turn. A second failure terminates the response with a protocol error.

The MVP may buffer a complete CUHK assistant turn before deciding whether it is text or a tool call. True token-by-token tool parsing is deferred.

### 6. Responses output and continuation

- Produce a valid non-streaming Responses object when `stream` is false.
- When `stream` is true, emit a valid Responses event order even if the CUHK turn was internally buffered.
- For a tool request, emit a standard function-call output item with the Bridge-generated `call_id`, tool name, and JSON argument string.
- Keep tool execution in Codex. The provider extension must never run shell, file, patch, or other host tools itself.
- Translate the matching `function_call_output` into a bounded, escaped tool-result message and send it to the same CUHK conversation.
- Continue until the model returns final text, requests the next sequential tool, reaches the configured loop limit, or fails.

### 7. Codex `apply_patch`

CCR normally decides whether to use its `virtual_apply_patch` bridge partly from the resolved model family. CUHK must instead force this bridge from provider capability because `gpt-5.6-sol` has a GPT-like name but the CUHK transport has no native freeform-tool channel.

Codex CLI 0.155 no longer sends a top-level `apply_patch` custom tool in the
verified configuration. It sends a developer `additional_tools` namespace with
the freeform `functions.exec` Code Mode tool. The implemented equivalent path is:

```text
Codex functions.exec namespace
  -> CUHK structured virtual functions__apply_patch
  -> TOOL PROTOCOL v1 text
  -> validated patch argument
  -> Codex custom_tool_call functions.exec with generated tools.apply_patch(...)
  -> Codex executes the patch and emits native file_change
```

The older top-level custom `apply_patch` path below remains supported and
covered by offline contracts for clients that still emit it.

The expected path is:

```text
Codex custom apply_patch
  -> CCR virtual_apply_patch function
  -> TOOL PROTOCOL v1 text
  -> validated function call
  -> CCR custom_tool_call apply_patch
  -> Codex executes the patch
```

## Minimum state

Persist enough state to complete a running task:

```text
client task/session key
CUHK conversation identifier
selected model and thinking level
tool catalog fingerprint and normalized catalog
pending Bridge call_id, tool name, and validated arguments
tool-loop count and terminal status
```

The MVP needs duplicate-result rejection within a live process. Durable crash recovery, leases, and ambiguous-delivery reconciliation are later hardening work.

## Acceptance scenarios

The MVP is complete only when automated fixtures and one live CUHK smoke run demonstrate:

1. A text-only Codex request returns a valid Responses result.
2. The model requests a simple function tool and Codex receives the correct native call.
3. A matching tool result returns to the same CUHK conversation and produces a final answer.
4. Two sequential tool calls complete in one task.
5. A tool-error result is visible to the model and it can respond or retry deliberately.
6. Unknown tool names, invalid JSON, schema violations, and a second malformed repair attempt fail without tool execution.
7. Codex `apply_patch` traverses the virtual-function bridge and returns to Codex as a custom tool call.
8. A catalog change causes a full catalog refresh; an unchanged catalog reuses the stored fingerprint.
9. Model and thinking-level changes from the existing settings panel are applied without editing Codex configuration.

## Explicitly deferred

- adversarial prompt-injection testing of tool output beyond basic escaping, size limits, and envelope isolation;
- parallel tool calls and multiple calls in one assistant turn;
- true token-by-token upstream streaming and incremental tool-argument deltas;
- durable recovery after process crashes and complete unknown-delivery reconciliation;
- catalog delta updates rather than full refresh on change;
- exhaustive JSON Schema dialect support and automatic multi-turn argument repair;
- attachments, images, audio, binary tool results, and very large outputs;
- verified Anthropic Messages and Chat Completions parity;
- multiple concurrent CUHK browser instances, quotas, rate limiting, usage estimation, and high availability;
- exposing CUHK-owned tools such as `web_search` as client-visible host tools;
- broad privacy, abuse, and adversarial-security review required for a production release.

Deferred work must not be advertised as supported. The MVP should fail clearly on unsupported inputs rather than approximate them silently.
