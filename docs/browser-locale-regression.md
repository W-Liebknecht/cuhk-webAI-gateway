# Browser language and model selection

The Windows clean-install reproduction on 2026-10-24 used the school's English
page (`html.lang=en-US`) at a 1008 × 569 viewport. The model trigger's accessible
name was `Qwen3.8 27B (On-Premises)` and its reasoning combobox was named
`Set reasoning for Qwen3.8 27B (On-Premises)`.

The old adapter queried semantic DOM controls, not fixed screen coordinates.
However, it required the trigger's `aria-label` to equal a Chinese display name.
Consequently it threw `CUHK AI model selector was not found.` before clicking the
trigger or submitting a message. OpenCLI's failure propagated through Gateway as
HTTP 502. A successful connection check only established that the composer was
available; it did not exercise model or reasoning selection.

`opencli-adapter/utils.js` now maps the observed Chinese and English model labels
to one canonical model identity. This covers current-model detection, opening the
dialog, selecting a model, verifying the selection, and locating and confirming
the reasoning combobox. On-premises suffixes remain part of the identity; an
unknown hosted variant is not silently substituted. Ambiguous or disabled
controls fail without choosing an arbitrary match. Reasoning options retain the
existing guarded ordinal selection, option-count check, live-label confirmation,
and keyboard fallback for acknowledged but undelivered browser input.

## Regression checks

Run the CUHK adapter suite from an OpenCLI checkout whose `clis/cuhk-ai` points to
this repository's adapter:

```powershell
npx vitest run --project adapter clis/cuhk-ai
```

The suite covers Chinese and English Qwen/GLM/Seed labels, model switching and
confirmation, highest reasoning, lost browser input, different fixture widths,
and refusal of disabled, duplicate, unknown or structurally changed controls.
Fixture widths do not substitute for testing the site's real responsive layout.

The Windows VM reproduced the old selector error on the English page. With only
`utils.js` replaced, the same page selected GLM on-premises and then Qwen
on-premises with `xhigh`, both returning exit code 0. Full command execution and
installer regression must be recorded separately from this selector check.

The subsequent `codex exec` run through the installed Gateway wrapper completed
three real shell commands: output `ok`, write `gateway-locale-smoke.txt`, and read
back its exact 29-byte content. All three command exit codes were 0 and the model
returned the results before `turn.completed`. The recorded policy was
`workspace-write`, network access disabled, with the existing elevated Windows
sandbox retained. Headless `exec` used its default `approval_policy=never`; this
does not establish that the interactive approval UI was exercised.

The VM received a backed-up, hash-checked replacement of the adapter utility
file. Installer releases must build from the matching source tag and pass the
Windows workflow's payload, silent-install, runtime and uninstall checks.
Clean-baseline browser-login and tool regression of the rebuilt installer is a
separate check; the VM hotfix test above does not replace it.

This reproduction does not establish that a different machine's runner pipe-out
timeout has the same cause. No local tool call occurred in the original VM 502
turns; model selection failed first.
