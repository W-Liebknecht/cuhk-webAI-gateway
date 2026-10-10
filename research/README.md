# Reference implementations

This directory contains read-only source checkouts used to evaluate possible architectures for the CUHK AI bridge.

- `claude-web-api/`: reference for translating a web AI session into Anthropic/OpenAI-compatible APIs and maintaining tool loops.
- `anyAIProxyAPI/`: reference for exposing browser-driven AI websites through an OpenAI-compatible HTTP proxy.

The two projects listed above are references only and are not launched by the control panel. Their source checkouts are ignored by Git and are not included in this repository's source archive.

Additional reviewed references are currently recorded by pinned revision rather than vendored into this directory:

- `claude-code-router/`: checkout of `musistudio/claude-code-router` at `cbe5f7bb3b3511ac31274559f2e9f387cab6fe40`; its built core server is the selected runtime Gateway host, as well as a reference for Codex profiles, Responses routing, and `apply_patch` bridging. It is ignored by Git and must be obtained and built separately; see [release readiness](../docs/release-readiness.md).
- `BerriAI/litellm` at `a8979fe05466346d78ab4573c8a61b53a4dd9cf6`: reference for provider/tool protocol transformations and event fixtures; not selected as a runtime sidecar.
- `vystartasv/toolcall-proxy`: conceptual reference for text-to-tool-call conversion. The public repository was unavailable during the 2026-09-16 review, so only its indexed README behavior was used and no source revision is claimed.

All third-party projects retain their own copyrights and licenses. This repository's MIT license does not relicense these checkouts; see [third-party notices](../THIRD_PARTY_NOTICES.md).
