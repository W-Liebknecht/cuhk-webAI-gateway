# 文档导航

初次了解项目请从 [项目首页](../README.md) 开始。当前使用与验收说明优先参考下表；日期命名的实验记录反映当时的环境，不应直接当作当前安装指南。

| 主题 | 文档 |
| --- | --- |
| 发布状态与安装缺口 | [发布准备清单](release-readiness.md) |
| Windows 安装、Chrome 权限、更新和卸载 | [安装指南](install.md) |
| Codex / Claude Code 使用、协议范围与验收 | [Claude Code Gateway](claude-code-gateway.md) |
| 组件分工与目标架构 | [Gateway architecture](gateway-architecture.md) |
| 网页命令与模型别名 | [OpenCLI adapter](opencli-adapter.md) |
| Agent 决策与 Gateway 验证 | [双向决策协议](bidirectional-agent-decision-protocol.md) |
| 尚未实现的多标签并发设计 | [多标签并发](multi-tab-parallel-architecture.md) |

## 历史与调查材料

- [初版 MVP 范围](ccr-cuhk-provider-mvp.md)、[工具 smoke 验证](tool-smoke-verification.md)：2026-09 的阶段性设计与验收。
- [原生工具调查](native-tool-architecture-notes.md)、[多轮恢复](multi-turn-recovery.md)：调查、故障与设计背景。
- `online-experiments-*.md`：按日期记录的实验方案、结果和修复；包含当时的环境路径及模型行为，供追溯。
- [研究目录说明](../research/README.md)：外部参考仓库、运行宿主和许可边界。

历史材料中出现的本机路径、运行日志路径和提交号是证据定位信息，不是通用安装步骤。私人运行日志与凭据不包含在公开仓库中。
