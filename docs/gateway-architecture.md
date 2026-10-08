# CUHK Gateway architecture

Status: accepted on 2026-09-16; implementation direction updated on 2026-09-17.

The proposed multi-tab concurrency extension is specified in [multi-tab-parallel-architecture.md](multi-tab-parallel-architecture.md). It is a design target, not an implemented capability.

## Goal

Provide one local CUHK Gateway that lets Codex, Claude Code, and other compatible agents use the authenticated school web AI as their primary model path. The settings panel controls Gateway availability, selected school model, and thinking level. CC Switch may point supported clients at the gateway without owning any CUHK-specific logic.

The target is to avoid using Codex model quota when an external agent client is connected directly to this gateway.

## Component boundaries

```text
CUHK AI Settings panel
        |
        | local configuration / hot reload
        v
CCR-based CUHK Gateway
        ^
        | one base URL, multiple protocol surfaces
        |
CC Switch / direct clients
        |
        +-- Codex:       OpenAI Responses
        +-- Claude Code: Anthropic Messages
        +-- Other:       OpenAI Chat Completions

CCR Gateway
        |
        | CUHK provider extension + emulated tool runtime
        v
OpenCLI + authenticated Chrome
        |
        v
ai.cuhk.edu.cn
```

Responsibilities:

- Settings panel: the `gatewayEnabled` switch, shared model choice and thinking level, and later tool mode. The panel does not edit Codex or Claude Code configuration.
- CC Switch: optional client routing, provider switching, and protocol conversion. It does not manage the school login, browser session, or CUHK model catalog.
- CCR Gateway: supplies the local HTTP API, Codex/Claude Code client integration, routing, model catalog, protocol surfaces, plugin lifecycle, and the existing Codex `apply_patch` bridge.
- CUHK provider extension: owns CUHK request/response translation, the constrained text tool protocol, catalog compilation, validation, session mapping, and provider-specific errors.
- OpenCLI: owns authenticated browser transport, page-context requests, network observation, session leases, and CUHK-specific browser automation.
- Agent client: owns local tool execution and its normal approval/sandbox policy.

## Local API surface

One CCR base URL should eventually expose separate protocol-compatible endpoints rather than forcing every client through one wire format:

- `POST /v1/responses` for Codex-compatible clients.
- `POST /v1/messages` for Claude Code and Anthropic-compatible clients.
- `POST /v1/chat/completions` for OpenAI Chat Completions clients.
- `GET /v1/models` for the normalized school model catalog.
- `GET /health`, `/health/live`, and `/health/ready` for process, browser, and login readiness.
- `GET/PUT /api/config` for the local settings panel.

The server must bind to loopback by default. Browser credentials, cookies, CSRF values, raw account identifiers, and sensitive prompts must not be exposed through health, control, or log endpoints.

## Configuration ownership

The CCR CUHK extension and panel share `config.json`. `gatewayEnabled` is consumed by the Gateway. The extension or CCR integration should eventually own a versioned configuration schema and expose atomic updates through `/api/config`.

Required modes:

- `locked`: the panel-selected school model and thinking level override model names sent by clients. This is the default user experience.
- `client-override`: an explicitly supported client model/effort may override panel defaults.

Precedence in `locked` mode:

1. Gateway safety and availability constraints.
2. Panel configuration.
3. Gateway fallback defaults.

Changing model or thinking level should not require restarting the gateway, Codex, Claude Code, or CC Switch. Changes to a client's base URL or displayed model catalog may still require restarting that client, depending on the client.

## Tool-call modes

The gateway must report tool capability honestly:

- `native`: only when the CUHK backend accepts client-defined tool schemas and exposes a result-continuation contract.
- `emulated`: a separately enabled fallback in which the gateway prompts for a constrained structured tool request, validates it, translates it into a client-native tool call, and feeds the tool result back to the school model.
- `disabled`: text/reasoning only; client-defined host tools are not advertised as supported.

Current evidence supports structured CUHK-owned tools but not arbitrary client tools. Therefore the gateway must not claim native host-tool support. The first Codex vertical slice will deliberately implement `emulated` mode through a constrained text protocol; see `ccr-cuhk-provider-mvp.md` for its accepted scope.

The emulated loop requires schema validation, explicit native/emulated diagnostics, a maximum tool-loop count, matching Bridge-generated call identifiers, and live-process duplicate-result rejection. Its current coordination contract is `AGENT DECISION PROTOCOL v1`: the web Agent explicitly chooses `tool`, `final`, or `blocked`; Gateway may return bounded factual control feedback but may not force more semantic work. Duplicate no-progress actions and protocol disagreements are bounded so neither side can create an infinite loop. See [bidirectional-agent-decision-protocol.md](bidirectional-agent-decision-protocol.md).

## Canonical internal model

The CUHK provider should emit a small protocol-neutral representation before CCR encodes client-facing output. It contains:

- ordered system, developer, user, assistant, tool-call, and tool-result messages;
- normalized model alias and thinking effort;
- text, thought, error, and tool lifecycle stream events;
- client session identity and CUHK `chat_session_id` / message-index mapping;
- cancellation and terminal status;
- usage values tagged as upstream, estimated, or unavailable.

Provider-specific NDJSON and text-protocol parsing must not leak directly into client protocol handlers. This keeps Responses, Messages, and Chat Completions behavior consistent and testable. For the MVP, only the Responses adapter is a release blocker and it may buffer a completed CUHK turn before emitting a valid client event sequence.

## Reference implementation use

- Use `musistudio/claude-code-router` as the host gateway instead of building another general-purpose HTTP router. Integrate CUHK through its wrapper/core gateway extension mechanism.
- Reuse CCR's Codex profile, OpenAI Responses surface, routing, logging, model catalog, and `virtual_apply_patch` bridge. Force the patch bridge by CUHK provider capability rather than the GPT-like school model name.
- Reuse OpenCLI for the browser/session transport instead of introducing a second browser controller.
- Use LiteLLM's provider transformations and streaming fixtures as protocol references, but do not add a full Python LiteLLM sidecar or a second runtime state machine.
- Use `vystartasv/toolcall-proxy` only as a conceptual reference for text-to-tool-call conversion; the CUHK parser accepts only the versioned, standalone envelope defined by this project.
- Adapt `beekamai/claude-web-api` concepts for protocol endpoints, SSE translation, session ownership, pending-tool state, result leases, recovery, and privacy-safe diagnostics.
- Adapt `luispater/anyAIProxyAPI` concepts for request queueing, provider/adapter separation, multi-instance boundaries, and OpenAI streaming envelopes.
- Do not copy provider-specific Claude `/tool_result` logic unless a corresponding CUHK contract is actually discovered.

## Delivery phases

1. Codex MVP: pin CCR, create the CUHK provider extension, connect OpenCLI, expose the selected CUHK models, implement a valid `/v1/responses` text path, and complete the sequential emulated tool loop including CCR's `apply_patch` bridge. The full scope and acceptance tests are defined in `ccr-cuhk-provider-mvp.md`.
2. Basic stabilization: improve cancellation and browser/login recovery, add live session isolation, exercise catalog refresh, expand fixtures, and verify ordinary coding tasks without broadening the advertised protocol surface.
3. Protocol expansion: verify Anthropic Messages and Chat Completions adapters, add Claude Code and CC Switch end-to-end examples, and decide which CCR protocol conversions can be trusted unchanged.
4. Reliability and security hardening: durable pending-call recovery, ambiguous-delivery reconciliation, adversarial tool-result handling, parallel calls, rate limits, privacy review, attachment handling, usage estimates, and regression/chaos testing.
5. Optional native path: continue native-contract investigation independently. Enable `native` only if CUHK later exposes a verified custom-tool registration and result-continuation contract.

## Acceptance boundaries

- A text-only response through an API-compatible endpoint is not proof of a working coding-agent tool loop.
- A prose or JSON-shaped request is not a native tool call unless it was produced and continued through a verified structured upstream contract.
- CC Switch compatibility does not replace direct endpoint contract tests.
- Unknown outcomes must be inspected before retrying to avoid duplicate quota usage or duplicated tool effects.
- Browser writes fail closed on conversation identity: bootstrap requires a verified blank chat, and every continuation must restore and re-check its recorded conversation URL before submission.
