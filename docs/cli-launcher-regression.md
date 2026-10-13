# Dual CLI launcher regression — 2026-10-13

The panel's Codex and Claude buttons already selected different launchers. The
previous console handoff fix was applied only to Claude; Codex still invoked a
nested cmd/PowerShell Gateway startup through an output pipeline. On a Windows
cold start, that chain could remain waiting after printing initialization status
instead of opening the client.

Both launchers now call `Start-CuhkGateway` in `bin/runtime.ps1`. It starts the
short-lived Gateway command hidden with output redirected to temporary local
files, waits only for that process, checks its exit code, and removes those files.
It does not use `Start-Process -Wait`, which would wait for the persistent server
descendants too. Each launcher then invokes its own PowerShell client wrapper
directly in the selected working directory. Codex keeps its cwd-filtered `resume`
picker; Claude starts a new interactive session. Client failures remain visible.

## Verification

Environment: Windows, Claude Code 2.1.277, Codex 0.162.0-alpha.17.2, logged-in CUHK
browser, local Qwen `qwen3.8-27b`. Online tools ran sequentially with thinking
`low`; the original configuration was restored byte for byte afterward.

| Check | Result |
| --- | --- |
| Both launchers: cold start and existing Gateway, path containing spaces, correct client/cwd/arguments | Passed; Codex receives `resume`, Claude receives no resume argument |
| Both launchers: Gateway exits with code 7 | Passed; error displayed, client never entered |
| Actual panel button callbacks: Codex → Claude → Codex | Passed; each invocation selects its own launcher and the same selected cwd |
| Provider/launcher regression suite | 179/179 passed |
| Panel suite | 12/12 passed |
| Actual Codex launcher, fresh Gateway | Native resume picker and new-session TUI displayed; Gateway/web AI returned `CODEX_GATEWAY_LAUNCH_20261013_OK` |
| Actual Claude launcher, existing Gateway | Native TUI displayed; Gateway/web AI returned `CLAUDE_GATEWAY_LAUNCH_20261013_OK` |
| Codex online local tools | Shell generated a new random receipt; native patch created proof.txt; shell readback and final answer matched the receipt |
| Claude online local tools | Bash → Read → Write → Edit → Read executed; proof JSON matched the random receipt and final stage; resumed session recalled receipt/stage without tools |
| Cleanup | Original config hash restored; Gateway ready, zero active tasks and pending tool calls |

The Codex tool smoke uses explicit `danger-full-access` only in its ignored test
workspace, following the existing smoke contract. Normal launcher permissions
are unchanged. The Codex smoke now uses a fresh directory per run, so an old
proof file cannot affect patch verification.

Reproduce the regression and sequential online tool checks:

```powershell
node --test gateway/cuhk-provider/test/*.test.cjs
python -m unittest discover -s app -v
# Requires the logged-in school browser and a running Gateway:
node gateway/cuhk-provider/test/codex-cli-online.cjs
node gateway/cuhk-provider/test/claude-cli-online.cjs qwen-tools
```

Local reports: `gateway/runtime-state/codex-online-report.json` and
`gateway/runtime-state/qwen-tools-online-report.json`; associated client logs
remain in ignored runtime state. This document contains no runtime keys or
private client logs. Online tests validate the current Windows/CUHK environment,
not a fresh installation on another computer.

Before the 2026-10-13 push, the published Windows installer changes were merged
into the local checkout. Its bundled Node discovery and frozen-panel root
handling were retained. The publication copy passed 179 provider/launcher tests;
the integrated panel passed 13 tests, including its existing frozen executable
root test; the scoped adapter suite passed 45 tests.
