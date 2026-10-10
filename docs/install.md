# Windows 安装指南

## 用安装程序安装（推荐）

1. 打开 [GitHub Releases](https://github.com/hfp556/cuhk-ai-codex-bridge/releases)。在最新版本的 **Assets** 中下载 `CUHK-AI-Bridge-Setup-<版本>-win-x64.exe`。不要下载 GitHub 自动生成的 `Source code` 压缩包当作安装程序。若暂时没有 EXE，请按下方“从源码安装”。
2. 双击 EXE，阅读许可证，按向导选择安装文件夹。默认安装在当前用户的 AppData 目录，不要求管理员密码。可以按需勾选“创建桌面快捷方式”。
3. 安装结束后阅读自动打开的“首次使用说明”。也可以从 Windows 开始菜单中的 **CUHK AI Bridge → 首次使用说明** 再次打开。
4. 安装 Google Chrome，在 Chrome 地址栏打开 `chrome://extensions`，开启“开发者模式”，点击“加载已解压的扩展程序”。从开始菜单打开 **CUHK AI Bridge → 打开 Chrome 扩展文件夹**，在 Chrome 选择窗口中选中这个 `extension` 文件夹。
5. 在同一个 Chrome 中打开 `https://ai.cuhk.edu.cn` 并自行登录，使用时保持 Chrome 开启。按官方说明另行安装 [Codex CLI](https://github.com/openai/codex) 或 [Claude Code](https://code.claude.com/docs/en/setup)，只需选择一种。
6. 从开始菜单或桌面快捷方式打开 **CUHK AI Bridge**，选择 CLI 要处理的工作目录、网页模型及思考强度，点击所需的客户端启动按钮。

安装程序包含 Node、固定版本的 OpenCLI 与 Claude Code Router、Chrome 扩展文件及独立控制面板。安装后无需再运行 `setup.ps1`，也无需安装 Git、Node 或 Python。它不会替你登录学校网站，也不会把扩展静默加入 Chrome。扩展权限如下方所述。

更新时从 Releases 下载新版安装程序，关闭已打开的客户端和 Gateway 后运行。使用相同安装目录会保留本地配置。卸载入口在 Windows “已安装的应用”或开始菜单；卸载前请自行备份需要保留的配置与会话。卸载器只移除由安装程序安装的文件，不主动删除个人配置或运行数据。

## 从源码安装

这份指南适用于 Windows 10/11 的源码安装。Gateway 和工具运行在你的电脑上，使用你已登录的 Chrome；无需维护者电脑在线。首次准备会下载并构建 OpenCLI、Chrome 扩展和 Claude Code Router，不包含学校账号或模型额度。

## 准备软件

- [Git for Windows](https://git-scm.com/downloads/win)。
- [Node.js](https://nodejs.org/en/download)，版本 22 或更新，包含 npm；安装时加入 PATH。已验证开发版本为 Node 24.19.0。
- [Python 3](https://www.python.org/downloads/windows/)，安装 Tkinter 与 Windows Python launcher。控制面板使用它们。
- Google Chrome。
- 你要使用的 [Codex CLI](https://github.com/openai/codex) 或 [Claude Code](https://code.claude.com/docs/en/setup)。只使用其中一个时无需安装另一个。按其官方说明安装；不要把登录凭据复制到本仓库。

在新终端确认 `git --version`、`node --version`、`npm.cmd --version` 和 `py -3 -c "import tkinter"` 能运行。若 Node 是某个应用内附带的精简运行时，可能没有 npm；首次构建需要完整 Node 安装。

## 获取与准备

```powershell
git clone https://github.com/hfp556/cuhk-ai-codex-bridge.git
cd cuhk-ai-codex-bridge
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

源码 ZIP 用户直接在解压后的 `cuhk-ai-bridge` 目录运行同一条 setup 命令，无需将解压目录初始化为 Git 仓库。请使用普通用户终端；不需要为了创建目录联接而提权。

脚本按 [dependencies.lock.json](../dependencies.lock.json) 下载固定提交到 `.dependencies/`，使用各上游的 npm 锁文件安装并构建运行时和扩展，检查 Node、适配器注册、扩展产物、SQLite 原生模块与 Tkinter。它会在缺失时从 `config.example.json` 创建本地 `config.json`；已有配置不会被替换。依赖目录版本不符或有源文件修改时，脚本会停止并提示，不会重置你的 checkout。

首次下载需要可访问 GitHub 和 npm。原生模块若没有适合当前 Node 的预构建包，npm 会显示编译依赖错误；请按错误信息准备构建工具，勿反复启动安装。检查不包含网页登录或模型调用。

可再次只做检查：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -CheckOnly
```

## Chrome 扩展与学校登录

1. 打开 `chrome://extensions`，开启开发者模式，选择“加载已解压的扩展程序”。
2. 选择本仓库的 `.dependencies\opencli\extension` 目录。
3. 打开 `https://ai.cuhk.edu.cn`，自行完成学校登录，保持 Chrome 开启。
4. 在仓库根目录运行下列检查：

```powershell
.\bin\opencli.cmd doctor
.\bin\opencli.cmd cuhk-ai status --format json
```

OpenCLI 扩展是通用浏览器桥接器。固定版本 manifest 请求 `debugger`、`tabs`、`cookies`、`activeTab`、`alarms`、`storage`、`tabGroups`、`downloads` 及 `<all_urls>` 站点权限；这比仅访问学校站点更广。你可以审查 `.dependencies/opencli/extension/manifest.json` 和上游代码，再决定是否安装；建议使用专门的 Chrome Profile。项目不要求输入学校密码，也不会通过 setup 自动登录或复制 Cookie。

## 启动与停止

双击仓库根目录 `CUHK-AI-Settings.cmd`，选择 CLI 要处理的工作目录、网页模型与思考强度，点击对应启动按钮。Codex 保留原生当前目录会话选择；Claude Code 可用 `/resume` 恢复其独立历史。已验收客户端版本与功能范围见 [验收说明](claude-code-gateway.md)。

```powershell
.\bin\cuhk-gateway.cmd status
.\bin\cuhk-gateway.cmd stop
```

关闭 CLI 窗口不会自动删除历史。Gateway CLI 数据保存在 `gateway/runtime-state/`，与正常 Codex/Claude 配置隔离；无需改写全局 provider 配置。首次使用时请在自己可检查的测试项目中验证工具权限和文件修改。

## 已有开发环境与自定义路径

原来的同级 `cuhk-ai-opencli/` 与 `research/claude-code-router/` 环境仍优先使用。新安装且不存在这些目录时，自动使用 `.dependencies/`。可以在启动终端中显式选择：

| 环境变量 | 内容 |
| --- | --- |
| `CUHK_NODE_EXE` | Node 可执行文件完整路径 |
| `CUHK_OPENCLI_ENTRY` | OpenCLI 构建后的 `dist/src/main.js` 完整路径 |
| `CUHK_CCR_ROOT` | CCR 根目录，含 `packages/core/dist/main/server.js` |
| `CUHK_CODEX_EXE` | 原生 `codex.exe` 完整路径，不能填写 npm 的 `.cmd` shim |

Codex 默认保留既有桌面安装的发现方式；没有桌面安装时，支持 PATH 上的原生程序及官方 npm 包中的 Windows 原生程序。Claude Code 通过 PATH 上的 `claude` 启动。自定义依赖目录安装可用 `setup.ps1 -DependencyRoot <目录>`，随后须设置上表中的 OpenCLI/CCR 路径。

## 更新与卸载

更新源码前关闭 Gateway CLI 并停止 Gateway，再 `git pull`。本地 `config.json`、依赖、日志和会话被 Git 忽略。若锁定依赖版本更新，请将旧 `.dependencies/` 改名保留，再运行 setup；旧开发环境仍优先发现时需显式选择新路径。没有自动清理或覆盖依赖的升级操作。

卸载时先关闭客户端、运行 `cuhk-gateway.cmd stop`，从 Chrome 移除 OpenCLI 扩展，再按需删除仓库目录。删除前可自行备份 `config.json` 和独立 CLI 历史；备份包含私人内容，不应公开上传。
