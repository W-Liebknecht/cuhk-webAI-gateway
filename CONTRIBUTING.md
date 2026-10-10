# 参与贡献

感谢你帮助完善 CUHK AI Bridge。当前欢迎可复现的兼容性问题、文档修正和安装打包贡献；具体缺口见 [发布准备清单](docs/release-readiness.md)。

## 提交问题前

1. 先看 [README](README.md) 的当前状态与已知边界，源码安装问题请先运行安装指南中的 `setup.ps1 -CheckOnly`。
2. 搜索已有 Issue；相同问题请补充新的复现信息。
3. 提供 Windows、Node、Codex/Claude Code、Chrome、OpenCLI 与本仓库的版本或提交号；说明所选网页模型、具体操作和预期/实际结果。
4. 只附最小化、脱敏的日志或截图。不要公开学校账号、Cookie、Gateway 密钥、完整提示词、对话、个人路径或用户项目内容。运行时目录 `gateway/runtime-state/` 和 `gateway/host-state/` 不应上传。

如果怀疑存在可被利用的安全问题，请按 [SECURITY.md](SECURITY.md) 私下报告，不要先公开复现细节。

## 提交 Pull Request

- 先在 Issue 中说明较大的行为改动，方便确认范围；小型文档和明确的缺陷修复可以直接提 PR。
- 保持改动聚焦，描述触发场景、修复方式与实际验证结果。网页交互或工具协议改动需说明是否用真实浏览器/CLI 验证；不要把模拟测试写成线上验收。
- 不提交本地配置、密钥、个人日志、学校网页的私人内容或研究仓库构建产物。
- 贡献的原创代码和文档按仓库的 [MIT License](LICENSE) 发布；保留引入的第三方代码原有版权与许可说明。

维护者按个人时间处理反馈，Issue 和 PR 不构成限时支持承诺。
