# CUHK AI native tool-call investigation

Date: 2026-09-16; architecture follow-up: 2026-09-17

## Result

The authenticated `https://ai.cuhk.edu.cn/chat/` endpoint exposes structured, server-executed tool events for tools registered by the CUHK platform, but it does not currently expose a client-defined tool registration surface.

Tested models:

| UI model | approach id | upstream API mode | CUHK `web_search` | client-defined function |
|---|---|---|---|---|
| GPT 5.6 Sol | `gpt-5.6-sol` | `response` | structured success | ignored / unavailable |
| DeepSeek V4.1 Flash | `deepseek-flash` | `chat.completion` | structured success | ignored / unavailable |
| GLM 5.3 Flash local | `glm-5.3-flash` | `chat.completion` | structured success | ignored / unavailable |

Successful built-in calls produce NDJSON items with this normalized lifecycle:

```text
type=tool, status=calling
type=tool, status=running
type=tool, status=success
```

The item includes `call_id`, `tool_name`, `arg_str`, and `result_str`. This is a real server-side tool execution, not a prose imitation.

The frontend configuration exposes these user-selectable tools:

```json
["web_search", "image_tool", "mind_map"]
```

Models appear to receive a wider fixed server tool catalog, but arbitrary schemas supplied as top-level `tools`, `params.tools`, `tool_choice`, or a custom `params.tool_proxy` were not registered. Unknown fields were accepted at the HTTP layer and silently omitted before model execution.

No frontend asset or captured request revealed a `tool_result`, dynamic tool-registration, MCP, function-registration, or side-channel endpoint. The visible request builder only forwards `params.tool_proxy` plus model-thinking parameters.

## 2026-09-25 Seed 2.1 Pro follow-up

The live model catalog identifies 豆包 Seed 2.1 Pro as `doubao-seed-2-1-pro-260915` with `chat.completion` transport and a binary off/on thinking selector. Although the product description advertises tool calling, the logged-in page state exposes only the fixed platform tools `web_search`, `image_tool`, and `mind_map`. The current request builder still sends a selected `tool_proxy`; it exposes no arbitrary JSON-schema tool registration, MCP catalog, or `tool_result` continuation contract.

Therefore Seed's advertised capability does not replace the Gateway's Agent tool bridge. The Seed profile keeps the emulated JSON catalog and explicitly prevents the model from substituting those three platform tools for local Codex tools. This can be simplified later only if the site exposes a real dynamic registration and result-continuation API.

## What OpenCLI can provide

OpenCLI is a good browser/session transport for the bridge:

- existing authenticated Chrome session reuse;
- persistent named session leases;
- page-context JavaScript execution;
- CDP network capture with request and response bodies;
- up to 8 MiB response-body capture;
- browser-side fetch/XHR response interception;
- plugin/adapter commands, tracing, typed errors, and verification fixtures.

OpenCLI currently captures requests and responses but does not contain a general request-body rewrite API comparable to Playwright `route.continue_()` or CDP `Fetch.continueRequest`. A CUHK bridge can still inject a page-world `fetch` wrapper through `page.evaluate`, or OpenCLI can be extended with an opt-in mutating interceptor.

That distinction does not solve the main limitation: rewriting the browser request only helps when the server accepts the injected fields. Current CUHK `/chat/` tests show that custom tool definitions are stripped or ignored server-side.

## Reference project comparison

### `musistudio/claude-code-router`

Selected as the host framework for the next implementation phase.

Reusable parts for CUHK:

- Codex and Claude Code client profiles;
- OpenAI Responses, Anthropic Messages, and Chat Completions gateway surfaces;
- provider routing, model catalogs, request logging, configuration, and extension lifecycle;
- the Codex `apply_patch` bridge, which translates the freeform custom tool through a `virtual_apply_patch` function and back without executing the patch itself.

CUHK-specific work remains necessary because CCR's ordinary providers assume a structured HTTP model protocol. The CUHK extension must connect to OpenCLI, translate the CUHK NDJSON/text turns, and force the patch bridge by provider capability. A GPT-like name such as `gpt-5.6-sol` is not evidence that the CUHK transport supports GPT-native tools.

### `BerriAI/litellm`

Useful as a reference for provider transformations, tool-call normalization, Responses event ordering, Anthropic content-block translation, and protocol fixtures. It should not run as a second proxy in the MVP: its internal types are substantially OpenAI-shaped, it uses a separate Python runtime, and a sidecar would create another streaming/session/error state machine.

### `vystartasv/toolcall-proxy`

Useful as evidence that text-form tool calls can be translated into client-native calls. Its published design mainly scans model output and forwards the incoming tool-bearing request unchanged, so it does not solve CUHK's request-side schema-to-prompt compilation or browser conversation continuation. The CUHK design also rejects its broader JSON-code-block and Python-style heuristics in favor of one standalone versioned envelope.

### `beekamai/claude-web-api`

Useful as the primary architecture reference.

Its decisive technique is provider-specific:

1. intercept the real `claude.ai` completion request;
2. merge client tools into the outgoing `payload.tools`;
3. parse native SSE `tool_use` blocks and incremental JSON arguments;
4. pause at the provider's native execution boundary;
5. POST results to the provider's dedicated `/tool_result` endpoint;
6. resume the same upstream SSE stream;
7. expose Anthropic Messages and OpenAI Chat Completions locally.

Reusable parts for CUHK:

- Anthropic/OpenAI HTTP compatibility surfaces;
- streaming event translation;
- per-client session ownership;
- pending-tool state, leases, duplicate-result protection, and ambiguous-delivery handling;
- health endpoints, request queueing, browser recovery, local-only binding, and privacy-safe diagnostics;
- Claude Code configuration using `ANTHROPIC_BASE_URL`.

Not directly reusable yet:

- arbitrary tool injection and `/tool_result` continuation, because the CUHK endpoint exposes neither contract.

### `luispater/anyAIProxyAPI`

Useful as a secondary reference for a generic website-to-OpenAI proxy:

- ChromeDP lifecycle and authentication persistence;
- request queueing and multi-instance management;
- YAML-driven browser workflows;
- response sniffing and OpenAI streaming envelopes;
- adapter separation for site-specific response formats.

Its tool support is adapter-dependent. For example, the Gemini AI Studio adapter parses a native website function-call structure into OpenAI `tool_calls`, while the ChatGPT adapter in the inspected CDP branch returns no tool calls. Therefore it is not a generic native-tool-loop solution by itself.

## Recommended architecture

Use CCR as the host gateway, add a CUHK provider extension, and retain OpenCLI for browser ownership and CUHK-specific protocol access:

```text
Codex / compatible agent
        |
        | OpenAI Responses
        v
CCR gateway
        |
        | CUHK provider extension
        v
catalog compiler + text tool runtime + session state
        |
        | OpenCLI browser/session transport
        v
OpenCLI + authenticated Chrome
        |
        v
ai.cuhk.edu.cn/chat/
```

The first implementation gate is now a Codex-focused MVP rather than a text-only gateway. It must complete one full sequential emulated tool loop, including schema-to-prompt compilation, strict standalone-envelope parsing, local schema validation, Responses function-call encoding, tool-result continuation in the same CUHK conversation, and CCR's `apply_patch` bridge. It is labeled `emulated`; it is not evidence of a native CUHK tool contract.

Parallel calls, comprehensive adversarial handling, durable crash recovery, catalog deltas, attachments, and full Anthropic/Chat Completions parity are deliberately deferred. See `ccr-cuhk-provider-mvp.md` for the accepted boundary.

## Reference revisions

- `musistudio/claude-code-router`: `cbe5f7bb3b3511ac31274559f2e9f387cab6fe40`
- `BerriAI/litellm`: `a8979fe05466346d78ab4573c8a61b53a4dd9cf6`
- `beekamai/claude-web-api`: `f81f68f0c808fa16667a2515eb3ab135109648d4`
- `luispater/anyAIProxyAPI` (`cdp` branch): `e06cdcf24f4ef2199cb8ba3f095899589be52e9f`
