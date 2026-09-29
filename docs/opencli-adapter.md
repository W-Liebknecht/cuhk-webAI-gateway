# CUHK-Shenzhen AI

Drive `ai.cuhk.edu.cn` through the logged-in Chrome session. This adapter deliberately uses stable, page-owned semantic attributes instead of replaying an undocumented private API.

## Commands

```powershell
opencli cuhk-ai status --format json
opencli cuhk-ai models --format json
opencli cuhk-ai model gpt5.6sol --thinking high --format json
opencli cuhk-ai new --format json
opencli cuhk-ai ask "Explain Dijkstra's algorithm" --model gpt5.6sol --thinking high --timeout 180 --format json
opencli cuhk-ai ask "Continue with an example" --new false --format json
opencli cuhk-ai read --format json
```

`ask` waits for a newly-created assistant turn, the page's completion controls, and stable text before returning. Its output is a single JSON row with a `response` field.

Configured aliases and thinking levels:

| Alias | Page model | Thinking levels |
| --- | --- | --- |
| `glm5.3flash` | GLM 5.3 Flash（本地版） | `low`, `high`, `max` |
| `glm5.3` | GLM 5.3 | none exposed by the page |
| `gpt5.6sol` | GPT 5.6 Sol | `none`, `low`, `medium`, `high`, `xhigh`, `max` |
| `deepseek-v4.1-flash` | DeepSeek V4.1 Flash | `none`, `high`, `max` |
| `kimi-k3` | Kimi K3 | `low`, `high`, `max` |
| `seed2.1pro` | 豆包 Seed 2.1 Pro | `none`, `high` |
| `gemini3.8flash` | Gemini 3.8 Flash | `low`, `high` |
| `qwen3.8-27b` | Qwen3.8 27B（本地版） | `none`, `low`, `medium`, `xhigh` |
| `gpt6sol` | GPT 6 Sol | `none`, `low`, `medium`, `high`, `xhigh`, `max` |
| `gpt6luna` | GPT 6 Luna | `none`, `low`, `medium`, `high`, `xhigh`, `max` |

## Authentication

Open `https://ai.cuhk.edu.cn` in Chrome and complete the university login yourself. OpenCLI reuses that browser session; it does not store a password or copy login cookies into this repository.

## Strategy note

Strategy: `UI_SELECTOR`

Contract: `visible-ui`

Evidence:

- The composer is exposed as `data-testid="chat-input"`.
- The send control is exposed as `data-testid="chat-send-button"`.
- Conversation turns are exposed as `data-turn="user"` and `data-turn="ai"`.
- A completed assistant turn exposes the visible `Regenerate` / `重新生成` action, and the stop control is absent.
- Authentication comes only from the existing Chrome session.

This is preferable to an undocumented internal endpoint for the first production version: it avoids copying tokens, accepts streaming UI updates, and fails with typed auth, execution, timeout, or empty-result errors.
