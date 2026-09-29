# CUHK CCR provider

This trusted local CCR wrapper exposes the CUHK web session through an OpenAI Responses-compatible endpoint. It implements buffered text, sequential tool calls, bounded arbitration, conversation reuse, image attachment handling, readiness checks, and the `AGENT DECISION PROTOCOL v1` compatibility layer.

The launcher allocates loopback ports dynamically and writes local credentials and conversation state under `gateway/runtime-state/`. That directory is private runtime data and must never be committed.

Run the offline contract suite from this directory:

```powershell
npm test
```

The tests use fake transports unless a live smoke command is selected explicitly. Live tests require the local Gateway switch, a running OpenCLI/Chrome bridge, and a user-authenticated CUHK AI page.

See the repository-level `README.md` and `docs/` for installation, architecture, protocol, and recovery behavior.

