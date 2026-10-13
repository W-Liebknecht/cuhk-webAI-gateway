# CUHK AI Bridge

把香港中文大学（深圳）AI 网页中的模型接入本地 Codex CLI 和 Claude Code CLI，为网页对话提供工具，操作本地文件。

> An experimental, local bridge from the CUHK-Shenzhen AI website to Codex CLI and Claude Code CLI. The browser stays logged in on your own computer.

## 功能
- 支持skill，视觉功能
- 可自由选择model与effort，启动 Codex 或 Claude Code CLI。
- 历史对话存储在对应的工作目录下
- 将网页模型生成的工具决策交回本地 CLI 执行
- 通过已登录的 Chrome `https://ai.cuhk.edu.cn`，无需上传密码。
  
```text
Codex CLI / Claude Code CLI
          │  本地协议
          ▼
  CUHK Gateway（本机）
          │  OpenCLI + Chrome 扩展
          ▼
  你已登录的学校 AI 网页
          │
          └─ 工具决策返回本机 CLI 执行
```

网页端AI须在使用时已登录

## 真实生成示例

由 Claude Code 经 Gateway 调用网页的 Qwen 生成。预览是其中一帧；点击 [原始 SVG](artifacts/pelican-bicycle.svg) 可下载或在浏览器中观看动画，验收方式见 [生成记录](docs/claude-code-gateway.md)。

![Claude Code 经 Gateway 生成的鹈鹕骑自行车 SVG 的静态预览](artifacts/pelican-bicycle-frame-0.png)


## 安装与使用

普通 Windows 用户：
请打开 [GitHub Releases](https://github.com/hfp556/cuhk-ai-codex-bridge/releases)，下载最新版本中名为 `CUHK-AI-Bridge-Setup-...-win-x64.exe` 的文件，双击运行并按照向导选择安装目录。安装完成后会打开首次使用说明。安装包包含 Node、OpenCLI、扩展文件和控制面板；仍需 Chrome、学校网页登录和选用的 Codex/Claude Code CLI。
详细图文步骤见 [安装指南](docs/install.md)。

开发者：
源码安装需准备 Git、Node.js 22+（含 npm）、Python 3（含 Tkinter）、Chrome 和选用的 CLI，然后在仓库根目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

脚本准备本地依赖，不发送模型请求。
新用户请按 [完整安装指南](docs/install.md) 加载扩展并检查环境，再启动客户端。

1. 在 Chrome 中安装 OpenCLI 的解压扩展，并自行登录 `https://ai.cuhk.edu.cn`。
2. 双击仓库根目录的 `CUHK-AI-Settings.cmd`，选择工作目录、模型和思考强度。
3. 点击 **启动 Gateway Codex CLI** 或 **启动 Gateway Claude Code CLI**。

也可以在仓库根目录调用现有启动器：

```powershell
.\bin\cuhk-codex-launch.cmd
.\bin\cuhk-claude-launch.cmd
.\bin\cuhk-gateway.cmd status
.\bin\cuhk-gateway.cmd stop
```

控制面板的“工作目录”是 CLI 要处理的项目。Gateway 状态、密钥和 CLI 独立数据在被 Git 忽略的 `gateway/runtime-state/` 中。本地 `config.json` 从安全的 `config.example.json` 初始化，不再提交到 Git；分享截图、日志和配置时请检查路径及私人内容。

## 原理与文档

| 想了解 | 入口 |
| --- | --- |
| 双 CLI 的使用方式、协议范围、真实验收 | [Claude Code Gateway](docs/claude-code-gateway.md) |
| Windows 安装程序、源码安装、扩展权限与更新 | [安装指南](docs/install.md) |
| Gateway 与浏览器适配层的边界 | [Gateway 架构](docs/gateway-architecture.md) |
| OpenCLI 命令、模型别名、网页交互策略 | [OpenCLI 适配器](docs/opencli-adapter.md) |
| 发布前缺口与复现限制 | [发布准备清单](docs/release-readiness.md) |
| 历史实验及研究副本 | [研究说明](research/README.md) |

`research/` 下的第三方研究仓库不包含在本仓库的 Git 内容里。上游依赖的许可与署名见 [第三方说明](THIRD_PARTY_NOTICES.md)。

完整入口与历史记录分类见 [文档导航](docs/README.md)；使用帮助见 [SUPPORT.md](SUPPORT.md)。

## 参与和反馈

欢迎分享真实使用反馈、复现步骤与修复建议，也欢迎给仓库 Star，帮助其他有同样需求的使用者找到它。报错请按 [贡献指南](CONTRIBUTING.md) 提供版本、触发步骤和脱敏日志；安全问题按 [安全说明](SECURITY.md) 私下报告。提交 Issue 不需要提供学校账号、Cookie、完整对话或本地文件。

本项目按个人时间维护，欢迎愿意自行检查代码、理解本地工具权限和协助排障的使用者。

准备分享项目时，可以使用 [项目简介](docs/project-profile.md) 中的短文；请说明这是开发版，并在安装包尚未发布时指向源码安装指南。

## 许可证

本仓库原创代码与文档按 [MIT License](LICENSE) 开放，允许使用、修改、再分发和商业使用，要求保留许可证与版权声明。Star。OpenCLI、Claude Code Router 及其他第三方组件保留各自的许可证和版权；详见 [第三方说明](THIRD_PARTY_NOTICES.md)。软件许可证不授予学校 AI 服务、账号或模型的使用权。
