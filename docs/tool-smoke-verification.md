# Tool smoke verification — 2026-09-17

CCR revision: cbe5f7bb3b3511ac31274559f2e9f387cab6fe40.

Verified path: HTTP Responses test client → CCR native provider/model routing →
CUHK plugin's registered HTTP backend → OpenCLI → Chrome → CUHK GPT 5.6 Sol.
Both model turns ran on the real website. The test client executed echo once.
It generated a random receipt after execution and submitted a matching
function_call_output. The final response passed exact JSON equality for echoed
value and receipt. Website read-back confirmed four visible messages in the
same conversation. No model reply was mocked. Report:
`../gateway/host-state/tool-smoke-report.json`.

Adapter strategy: UI_SELECTOR, visible-ui contract. Completed assistant bodies
are selected through `.prose-code-custom`; Regenerate present and Stop absent
confirm completion. Standalone tool protocol is extracted before Turndown.
Code, inline-code and blockquote examples remain Markdown; no global unescaping
of tool arguments. Auth remains in Chrome. Existing typed authentication and
timeout failures remain unchanged.

Tests at the original HTTP milestone: 10 adapter tests and 24 gateway tests passed. The shared switch was disabled;
the authorized smoke used explicit `--smoke-config` with the isolated enabled
configuration. It did not change the user's shared configuration. Host stopped
after testing.

This first harness was not Codex CLI; the later acceptance below closes that
gap. School AI was used only as the target of the explicitly authorized live
smoke, not as an implementation consultant.

## Codex CLI MVP acceptance — 2026-09-17

Codex CLI 0.155.0-alpha.2.6 was run with an isolated `CODEX_HOME` and the CCR
public Responses URL. Three live runs passed through Codex → CCR → CUHK provider
→ OpenCLI → authenticated Chrome → CUHK and back:

- text: final `CUHK_CODEX_TEXT_OK`, exit 0, one gateway request;
- shell: native `command_execution`, exit code 0, expected stdout, final answer,
  and two gateway requests proving result continuation;
- patch: native completed `file_change`, exact marker-file contents, final answer,
  and two gateway requests proving result continuation.

Reports are `../gateway/host-state/codex-{text,shell,patch}-smoke-report.json`.
The capture found and fixed two real integration constraints: Windows system/VPN
proxy interception of loopback requests (the wrapper sets `NO_PROXY`) and the
Windows command-line length limit (large prompts now remain file-backed through
the OpenCLI adapter). Current Codex uses `additional_tools` plus namespaced
`functions.exec`; the provider maps structured virtual shell/patch calls into
safe Code Mode input and accepts segmented custom-tool output during full-history
replay.
