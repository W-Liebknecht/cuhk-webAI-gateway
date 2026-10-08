# CUHK CCR provider

This directory is the first CCR vertical slice for the CUHK AI gateway. It is a trusted local wrapper plugin for the pinned CCR revision `cbe5f7bb3b3511ac31274559f2e9f387cab6fe40`.

Implemented surfaces:

- `POST /v1/responses`: buffered OpenAI Responses text and sequential tool calls;
- Responses `usage`: mirrors the school page's live context-used percentage on a stable 100k ratio scale, allowing Codex to render the Web AI conversation's context-left value after every web turn;
- CCR-owned `/models` and `/v1/models`: registered CUHK model catalog;
- `GET /plugins/cuhk/health/ready`: privacy-safe local readiness;
- `AGENT DECISION PROTOCOL v1`: every tool-capable web turn may explicitly choose `tool`, `final`, or `blocked`. The web Agent owns goal semantics and completion; Gateway owns execution facts, validation, pending state, and safety. Either side can challenge the other without silently taking over its authority.
- `TOOL PROTOCOL v1`: retained as a compatibility parser for existing raw `<tool_call>` envelopes, model-profile fenced JSON, and GLM's narrow PowerShell bridge. Calls still receive catalog fingerprinting, schema validation, loop bounds, duplicate-result rejection, and catalog refresh.
- Bounded arbitration: invalid/ambiguous responses and duplicate no-progress actions receive a structured `GATEWAY CONTROL v1` fact report, not an imperative repair script. The web Agent may correct that report and finalize. Two control turns without real progress terminate with a protocol error instead of looping forever.
- Model profiles: generic GPT-class models keep the generic compatibility protocol. `glm*`, `deepseek*`, `kimi*`, `qwen3.8-27b`, `seed2.1pro`, `gemini3.8flash`, `gpt6sol`, and `gpt6luna` selections receive an exact model identifier and a shared primary-Agent contract. Profiles also receive short tool names (`exec_command` / `apply_patch` / `wait`), stripped-down web context without the host model persona, tolerant fenced-JSON parsing with legacy aliases, and decision reminders. Only GLM enables the fenced PowerShell compatibility bridge; all other dedicated profiles remain JSON-tool-only. Qwen's prompt separates the school's fixed platform tools from the Gateway catalog and forbids provider-native tool objects; Seed has the same platform-tool separation, while Gemini and GPT 6 are instructed not to emit provider-native function-call objects because this browser bridge consumes text JSON.
- Codex title/summary jobs are isolated metadata operations: they receive no Agent identity or host tools, discard environment-context noise, always start a disposable web conversation, and never reuse or update the foreground Agent conversation ledger.
- Codex `apply_patch`: custom tool to `virtual_apply_patch` protocol function and back to `custom_tool_call`.
- Codex 0.155 Code Mode: `additional_tools` namespaces, structured virtual
  `exec_command`/`apply_patch`, segmented custom-tool results, full-history replay,
  namespace filtering to shell/patch/wait, and bounded web-prompt system context.
- Conversation reuse: one Codex conversation maps to one CUHK web conversation; after the
  bootstrap turn only new user/developer items are typed; a compact TOOL PROTOCOL v1
  REMINDER is appended on unchanged-catalog continuations and the full catalog is
  re-injected only when it changes (see below).

Register `src/ccr-registration.cjs`'s provider in CCR `Providers` and install this local extension with trusted-code, gateway-routes and http-backends permissions. CCR owns the public Responses endpoint and registry. The launcher allocates the management, public gateway, core, and plugin backend loopback ports at startup and stores them in `gateway/runtime-state/control.json`. Normal operation reads `../../config.json` on each request.

Run the offline contract suite with the repository's Node runtime:

```powershell
npm test
```

The suite uses a fake transport and does not spend CUHK quota. A live smoke run should only be performed when the panel's Gateway switch is enabled and Chrome is logged in.

## Conversation reuse

Codex replays the whole conversation on every request. The original implementation compiled
that replay (`instructions` + full history + tool catalog) into one web prompt for a **fresh**
CUHK conversation each turn, which is why the web page showed one exploding prompt and why
every CLI message opened a new chat. It is also the reason the replay had to be resent: the
gateway never owned a web conversation identity.

The provider now keeps a ledger keyed by the stable Codex conversation id
(`body.prompt_cache_key`, falling back to `client_metadata.session_id` / `thread_id`):

- first request for a key: full bootstrap prompt, `--new true`;
- later requests: only the history items that web conversation has not seen (`--new false`), so
  the CUHK page answers inside the same conversation. Assistant text is dropped from the delta
  because the web model produced it itself;
- the `TOOL PROTOCOL v1` catalog is typed only on bootstrap or when its fingerprint changes;
- the ledger stores item digests only (`gateway/runtime-state/conversations.json`), never prompt
  text, survives gateway restarts, and is pruned after 7 days / 64 conversations.

Set `"conversationReuse": false` in `config.json` to fall back to one fresh CUHK conversation
per turn. The default is `true`.

Conversation identity is enforced on both sides of a task. A bootstrap clicks the page's
**New Chat** control and verifies the base `/chat/` URL, zero user/AI turns, and a live composer
before sending; merely navigating to `/chat/` is rejected because the SPA can restore the most
recent old conversation. Continuations navigate to the session's recorded `/chat/c/<id>` URL
and verify it immediately before submission and again after generation. A mismatch fails closed
without typing, so manually switching to another history item cannot receive a Gateway delta.

### Stalled or interrupted turns

The school page sometimes stops generating mid-answer. Submission is now confirmed by observing the new user turn within 30 seconds. A silent spinner is stopped once after the configured inactivity threshold (5 minutes by default), and a Stop control that remains stuck fails after another 15 seconds. The total web budget defaults to 30 minutes and can be lowered with `webTimeoutSeconds`; uncertain writes are never resent. A turn is
treated as stuck once it has been in flight (or waiting for a tool result) longer than `staleTurnMs`
(default: transport timeout + 20 s startup slack + 60 s). A stuck turn is abandoned: its tool-result
slot is released and its ledger entry dropped, so the next request bootstraps a fresh CUHK conversation
instead of returning 409 until the gateway is restarted. `index.cjs` also watches for a Codex interrupt
(request `aborted`, or an early response close) and drops that turn's ledger entry, because the web chat
would otherwise hold an answer the CLI never received.

## Verification and runtime use

The plugin uses CCR's registered HTTP backend lifecycle, provider topology,
ModelRegistry and public routing. Codex CLI 0.155 live runs passed text,
`command_execution`, full-history custom-tool continuation, and native
`file_change` verification. Current Codex exposes editing through the
`functions.exec` Code Mode namespace rather than a top-level custom
`apply_patch`; the provider therefore compiles structured virtual shell/patch
calls and safely creates the Code Mode input. The legacy top-level
`apply_patch` bridge remains covered by offline contracts.

Start the persistent local runtime with `..\..\bin\cuhk-gateway.cmd start` and
run Codex through `..\..\bin\cuhk-codex.cmd`. Readiness actively probes the
Chrome login and composer state before a request enters the browser transport.

The regression suite now also checks nonduplicating SSE deltas, final text after
the last permitted tool call, failure cleanup without resending, continuation-time
panel changes and tool choice. User `input_image` parts now accept local paths,
`file:` URLs, and image data URLs; image turns use `gpt5.6sol`, which was verified
against the school page's image attachment flow. Remote image URLs remain rejected.

Host integration attempt: dependencies installed from the pinned lockfile and
`buildCoreServer` succeeded. The isolated management host started on loopback
port 3459; plugin configuration was saved with `applyProfile: false`. SQLite
required `npm rebuild better-sqlite3` after the initial script-free install.
The original `No available models` startup failure is resolved by registering
CUHK AI through CCR's native Providers configuration. Test host and
gateway were stopped after inspection. Isolated state is under
`../host-state/`; it is local runtime data, not source to share or commit.

Current verification (2026-09-17): 26 gateway tests and 11 CUHK adapter tests passed.
Conversation reuse and tool-prompt hardening (2026-09-18 / 2026-09-19): 48 provider contract tests pass, covering bootstrap-vs-delta prompting, catalog-once injection with unchanged-catalog TOOL PROTOCOL reminders, strict fenced-JSON tool parsing, cross-conversation isolation, restart persistence (digests only) and uncertain-bootstrap safety.
Live text Responses and a two-turn echo loop passed through real CCR, OpenCLI,
Chrome and CUHK. Echo executes once in the HTTP smoke harness; a random receipt
is generated only after execution. The final JSON must exactly match both the
echo value and receipt. The website's four visible messages were read back to
confirm the call, result and final reply. Reports: `../host-state/live-smoke-report.json`
and `../host-state/tool-smoke-report.json`. These are HTTP harness results, not
Codex CLI evidence is recorded separately in
`../host-state/codex-{text,shell,patch}-smoke-report.json`: all exit 0; shell
records a completed command with exit code 0; patch records a completed native
file change; both tool runs contain two public gateway requests.

2026-09-21 GLM online acceptance: provider contract suite is 57/57 as of 2026-09-21 16:47. With the panel
temporarily set to `glm5.3flash` / `high`, a real Codex CLI run through this
provider succeeded end-to-end. GLM emitted fenced PowerShell scripts instead of
tool JSON; the GLM profile executed those scripts as implicit `exec_command`
bridges, Codex reported native `command_execution` with a final exit code 0, and
the file `C:\Users\14441\Desktop\cuhk-glm-final-20260921T123052.txt` was created
with the exact expected 17-byte content. Web read-back shows bootstrap -> first
script -> tool result -> corrective second script -> tool result -> final
verification in one CUHK conversation. Evidence:
`../host-state/online-tool-test-glm-final.stdout.log`. The shared panel
configuration and web-page model were restored after the test.

Run `node test/ccr-smoke.cjs --tool-live` for the live echo test. By default it
honors the shared `gatewayEnabled` panel switch. `--smoke-config` explicitly selects
the isolated Gateway-enabled test configuration for an authorized test, without
changing that switch.
Tool protocol text is extracted before Turndown only for a standalone non-code,
non-quoted assistant body; JSON bytes are not globally unescaped.

Run `node test/codex-smoke.cjs text|shell|patch` for the real Codex CLI smoke.
It uses an isolated Codex home and Gateway-enabled smoke configuration, and never
edits either shared panel switch.
