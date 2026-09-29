# Multi-turn tool continuation and recovery — 2026-09-21

## Empty bubbles, long thought, and progress queries (follow-up)

The follow-up fixes the remaining cases reported with a screenshot containing
`此回复没有内容` and a valid tool reply in the same response group:

- Response observation searches all assistant bubbles after the latest submitted
  user message. It selects the latest substantive answer and ignores empty
  placeholders on either side. It never falls back to an earlier user's answer.
  Empty replies get a 15-second replacement grace period before recovery.
- Confirmed empty/interrupted generations receive one short continuation in the
  same conversation. It refers to the existing task and results without replaying
  the full prompt/catalog. A spinning generation with no answer and no visible
  text changes for five minutes is stopped; the adapter then observes the page
  again before classifying it as empty, so an answer arriving during Stop is not
  discarded. Changing reasoning text counts as activity.
- The provider's web wait is 900 seconds instead of 180. OpenCLI's parent process
  allows 60 additional seconds for cleanup, and drains stdout before returning.
  The CCR request budget and wrapper's stream idle budget are one hour, allowing
  for a long generation followed by recovery. SSE waiting comments continue
  every ten seconds. These are finite
  budgets, not a promise that arbitrarily long generations will always finish.
  The wrapper setting was checked against the official
  [per-provider configuration documentation](https://learn.chatgpt.com/docs/config-file/config-advanced#azure-provider-and-per-provider-tuning).
- The command bridge yields after ten seconds and preserves the complete tool
  result, including `session_id` and `exit_code`. The `write_stdin` bridge reads
  the same process with an empty input string. Process ids and Code Mode cell ids
  are separate. If a process has not returned an exit result, a premature final
  claim or an exact duplicate launch is converted to a poll. General operations
  default to a 32-call budget; polls have a separate 256-call budget.
- Same-conversation progress requests can return Gateway's known state while a
  web generation or tool result is pending. They do not write another web prompt,
  execute a command, or consume the pending call. The answer reports elapsed time
  and the last received output, not an invented percentage. Other supplemental
  instructions are queued (up to eight) and applied when generation or the tool
  result returns. A new user message after a pending tool result no longer hides
  that result; a progress question gets priority over requesting further tools.
- Health output now identifies `web_generating` versus `awaiting_tool_result`,
  elapsed seconds, pending tool name, and queued-input count. It contains no
  command text or result bodies. Separate CLI conversations still cannot write
  concurrently into the one shared browser conversation.

Follow-up verification: 73 provider tests and 25 adapter tests passed. Scenarios
include both empty/valid bubble orders, delayed replacement, no previous-answer
leakage, simulated 210-second thought, stopping a silent spinner, status queries
during generation and command execution, steered tool-result replay, preserved
process metadata, and polling past the old eight-operation limit. The opt-in
live test is `gateway/cuhk-provider/test/live-progress.cjs`; it permits only a
fixed twenty-second test command and uses a controlled client, not the Codex TUI.
Its report is `gateway/host-state/live-progress-report.json` when successful.

The real GLM 5.3 Flash / high test passed through CCR, the provider, OpenCLI and
Chrome: one local process launch, two polls of that same process, confirmed exit
code zero, and the final `CUHK_LONG_DONE` reply. The concurrent progress request
completed in 42 ms without a browser write or 409; one SSE heartbeat was observed.
This verifies the controlled client path, not every Codex TUI input/interrupt
behavior. The empty-bubble and 210-second thought tests use deterministic DOM
fixtures rather than deliberately causing the school website to fail.

The older Gateway logs contained repeated 409 conflicts, 180-second timeouts,
and the eight-operation limit. They did not retain sufficient command details
to identify the user's exact C-drive scan. No C-drive scan was rerun.

## Cause and changes

Codex replays earlier tool calls and results in later requests. Previously,
`parseInput` selected the last tool result anywhere in that history, including
when a newer user message followed it. The runtime then rejected the already
consumed result with `duplicate_tool_result`, before sending the second task.
Parsing now treats results before a later user message as historical; results
after the latest user message still enter the pending-call validator.

For requests with a conversation key, identical requests share an in-flight
operation or its completed response. Tool-result retries return the original
response and call identifiers. Changed duplicate results remain rejected.
Disconnecting an HTTP client no longer discards a keyed request's eventual
answer or conversation ledger. The Codex wrapper allows one request/stream
retry to reconnect. A running browser operation cannot be replaced merely
because the stale-session clock expires.

Streamed requests emit SSE keepalive comments every 10 seconds while awaiting
the web response. Failures after headers are sent terminate with a structured
SSE error, rather than attempting a second HTTP JSON response.

The adapter detects an idle submitted turn with no new answer after 15 seconds,
including when no AI bubble or Regenerate button appears. Stable answer text
can also complete without that button after the idle grace period. A visible
Stop button prevents this fallback. A confirmed empty response gets one
bounded recovery in the same web conversation, with the original task context.
Uncertain delivery/timeouts are not automatically resent to the webpage.

## Verification

- 65 provider tests passed, including two independent tool-using tasks with full
  history replay for both GPT and GLM; concurrent retries; retrying a tool
  result; dropped-client recovery; bounded empty recovery; uncertain-delivery
  errors; late-operation protection; SSE keepalive and terminal error delivery.
- 17 adapter tests passed, including missing AI bubbles, empty bubbles, completed
  answers without Regenerate, and active-generation protection.
- Provider syntax checks and Git whitespace checks passed.
- Real GPT 5.6 Sol / medium: two tasks, each requesting a test-receipt tool and
  returning its newly generated random receipt exactly. Four browser calls used
  `isNew = [true, false, false, false]`. This used the provider runtime and real
  OpenCLI/browser transport directly.
- Real GLM 5.3 Flash / high: the same two-task receipt test passed through the
  public CCR Responses endpoint, including one observed SSE heartbeat. Web
  read-back showed eight alternating user/assistant messages in one conversation.
- Real Codex CLI: task two resumed the exact CLI session from task one, emitted
  a tool request, received its result, and returned a final answer without
  `duplicate_tool_result`. Its file-reading commands were rejected by the CLI's
  execution policy (`blocked by policy`), so this is evidence for multi-turn
  request/error delivery, not successful CLI file access. No policy bypass was
  used.

Local, gitignored evidence: `gateway/host-state/multi-turn-live-report.json`,
`multi-turn-web-read.json`, `multi-turn-cli-first.log`, and
`multi-turn-cli-second.log`. The receipt harness is under
`gateway/host-state/multi-turn-fixture/live.cjs`.

## Limits

The request/result cache is process-local and retains at most 64 settled entries
(live entries are not evicted). It does not survive a Gateway restart. A closed
CLI cannot receive a response until it reconnects; the Gateway cannot inject
messages into a terminated client. Missing conversation keys retain legacy
non-idempotent behavior. The existing browser adapter still relies on the active
web conversation; manually switching browser conversations during a task is not
covered by durable conversation identity. The one empty-turn recovery is tested
with deterministic failures; the live successful tests did not force the school
website to fail. Later CLI launches pick up the wrapper's retry setting.
