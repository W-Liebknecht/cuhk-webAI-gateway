# CUHK Web AI → Codex Bridge

把已登录的 CUHK-Shenzhen 网页 AI 会话接成 Codex 可调用的本地 Agent/Gateway。项目通过 OpenCLI 控制 Chrome 页面，通过 Claude Code Router（CCR）提供 OpenAI Responses 接口，并支持 Codex 的 shell、补丁、等待与多轮工具闭环。

> 这是面向 Windows 的个人实验项目，不是学校官方服务。使用前请确认你有权访问目标网页，并遵守学校、模型供应商及课程的使用规则。

## 能做什么

- 从命令行调用学校网页 AI；
- 为 Codex CLI 提供本地 `/v1/responses` Gateway；
- 将网页模型的文本决策转换为受校验的本地工具调用；
- 让同一个 Codex 会话复用同一个网页会话；
- 读取网页上下文使用率，通过 Responses `usage` 同步 Codex 的剩余上下文指示；
- 提供模型、思考强度、Gateway 开关和工作目录的本地控制面板；
- 隔离 Gateway Codex 的配置、历史和附件，不改写桌面端的官方订阅配置。

## 仓库内容

```text
app/                    本地设置面板
bin/                    Gateway 与 Codex 启动入口
opencli-adapter/        CUHK 网页适配器及测试
gateway/cuhk-provider/  CCR provider、Responses/工具状态机及测试
docs/                   架构、协议与恢复设计
config.example.json     不含个人数据的配置模板
```

## 依赖

- Windows 10/11；
- Node.js 22 或更高版本；
- Python 3（仅设置面板需要，使用标准库 Tkinter）；
- Chrome；
- Codex 桌面端/CLI；
- [OpenCLI](https://github.com/jackwener/opencli)；
- [claude-code-router](https://github.com/musistudio/claude-code-router)，当前验证 revision：`cbe5f7bb3b3511ac31274559f2e9f387cab6fe40`。

建议把本仓库与 `cuhk-ai-opencli` 放在同一父目录；也可以分别通过 `CUHK_OPENCLI_ROOT`、`CUHK_CCR_ROOT` 和 `CUHK_AI_BRIDGE_ROOT` 指定位置。

## 安装

1. 克隆并按上游说明构建 OpenCLI。把本仓库的 `opencli-adapter` 作为目录联接放到 OpenCLI 的 `clis/cuhk-ai`，然后重新生成 OpenCLI manifest：

   ```powershell
   $bridge = Resolve-Path .\cuhk-ai-codex-bridge
   $opencli = Resolve-Path .\cuhk-ai-opencli
   cmd /c mklink /J "$opencli\clis\cuhk-ai" "$bridge\opencli-adapter"
   Set-Location $opencli
   npm install
   npm run build
   ```

2. 准备 CCR 的已构建 checkout，并设置 `CUHK_CCR_ROOT`。如 OpenCLI 不在默认相邻目录，同时设置 `CUHK_OPENCLI_ROOT`。

3. 创建本地配置。`config.json` 已被 Git 忽略，不应提交：

   ```powershell
   Copy-Item .\config.example.json .\config.json
   ```

4. 按 OpenCLI 说明加载 Chrome 扩展，打开 `https://ai.cuhk.edu.cn` 并由用户本人完成登录。仓库不会读取或保存密码、SSO Token 或浏览器 Cookie。

5. 双击 `CUHK-AI-Settings.cmd`，选择模型和工作目录，然后点击“启动 Gateway Codex CLI”。会话选择器按所选工作目录筛选历史会话。

## 上下文显示

Gateway CLI 启动器显式启用底栏的 `context-remaining`，因此新版 Codex 也会显示 `Context …% left`。该比例在每个网页回合完成后更新；显示单位已补偿 Codex 的有效窗口与固定提示基线，并不代表学校模型的真实 token 数。更新启动器后，已有 CLI 窗口需要退出并重新打开；更新 provider 后需要重启 Gateway。

## 验证

```powershell
.\bin\opencli.cmd doctor
.\bin\opencli.cmd cuhk-ai status --format json
.\bin\opencli.cmd cuhk-ai models --format json
node --test .\gateway\cuhk-provider\test\*.test.cjs
```

OpenCLI adapter 测试依赖上游仓库的 Vitest；建立目录联接后，可从 OpenCLI 仓库执行对应 adapter 测试。

## 隐私与安全

- `config.json`、Gateway runtime/host state、日志、会话账本、Codex 隔离数据、依赖目录和研究 checkout 均被忽略；
- Gateway 只监听 loopback，并为每次实例生成本地随机凭据；
- 网页认证保留在 Chrome profile 中；
- 不要提交截图、网络抓包、网页导出、真实对话 URL 或学校账号信息；
- 远端图片 URL 不会自动下载；本地图片只在显式附加时传给已登录网页会话。

核心设计见 [Gateway architecture](docs/gateway-architecture.md) 和 [bidirectional agent decision protocol](docs/bidirectional-agent-decision-protocol.md)。

