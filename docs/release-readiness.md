# Windows 源码发布准备（2026-10-09）

> 本文记录 2026-10-09 的源码发布验收。后续 Windows 安装程序的构建与首次使用流程见 [安装指南](install.md) 和 [构建工作流](../.github/workflows/windows-installer.yml)；本文当时的“尚未制作安装器”是历史状态。

当前可按 [Windows 安装指南](install.md) 从源码准备依赖与启动客户端。源码包与一键桌面安装包是不同的交付形式；本轮完成源码分发所需的入口、依赖和配置整理，尚未制作 EXE/MSIX 安装器。

## 本轮完成项

| 发布门槛 | 处理结果 |
| --- | --- |
| 入口绑定维护者绝对路径 | Gateway/OpenCLI 改为 Node 发现与覆盖变量；新增 `.dependencies` 路径发现，保留旧同级 OpenCLI 与 research CCR 的优先级 |
| 上游依赖无法复现 | `dependencies.lock.json` 锁定公开 OpenCLI v1.8.8 和 CCR 提交；`scripts/setup.ps1` 下载、npm ci、构建并检查 |
| 适配器靠本机联接注册 | 本仓库入口显式注册适配器；健康检查也走该入口，Markdown 依赖从选定的 OpenCLI 运行时解析 |
| 扩展/客户端安装信息不足 | 安装指南列明扩展目录、全部 manifest 权限、Python/Tkinter 与 CLI 发现方式，以及更新和卸载步骤 |
| 本地配置可能被分发 | `config.example.json` 作为安全模板，`config.json` 退出 Git 跟踪并被忽略；缺失时初始化，不替换已有文件 |
| 发布包夹带本地数据 | 源码打包脚本按允许的源码目录与根文件收集，排除配置、凭据/会话目录、依赖和项目记忆，附文件清单 |
| 第三方说明与依赖清单 | 保留上游原始 LICENSE/NOTICE，不把运行时打入源码 ZIP；setup 生成 npm 包名/版本/许可证元信息清单 |

## 实际验证

- 在独立的空解压目录中，从 GitHub 下载两个固定提交，成功构建 OpenCLI、扩展与 CCR；SQLite 原生模块能运行，依赖清单生成了 905 个包记录。没有使用维护者原有 OpenCLI/CCR 的源码或构建产物。
- 最终源码副本使用这套独立构建的依赖启动 Gateway，检查 `running: true`、`browser_ready: true`、`browser_login: Yes`，随后正常停止。网页登录验证复用了本机已登录的 Chrome，没有发送模型任务。
- 既有 Codex 0.160.0 与 Claude Code 2.1.277 入口均能运行；真实 Claude CLI 的离线 Write → Read → Edit → Bash、后台输出读取和权限/路由隔离验收通过。
- 最终离线回归：Provider 175/175（包含新增的 3 项分发回归），主仓库适配器 45/45，面板 10/10。适配器测试入口排除了 worktree 和 runtime-state 中的旧测试副本。
- 本地 `config.json` 修改前后 SHA-256 相同；源码包检查确认不包含 config.json、项目记忆、运行时状态或 node_modules。

完整逐项审阅入口见 [本轮改动说明](release-changes.md)。以上是同一台 Windows 电脑上的独立源码/依赖验证；Node、Python、CLI、npm 缓存和 Chrome Profile 仍是本机环境，不能当作全新操作系统验收。

## 剩余发行工作

- 2026-10-10：维护者确认在线验收已完成、运行正常，并授权推送 GitHub。具体环境与逐项结果未另行提供；上述独立安装验证的环境边界仍保留，不据此宣称完成全新 Windows/Chrome 环境测试。
- 若希望免构建、双击安装，需要另行制作安装器并决定是否随包分发运行时；届时按实际包含的所有依赖核对许可证和完整法律文本。当前 905 项元信息清单不是法律审计。
- 把已审阅源码提交/推送，设置 GitHub About、Topics 和安全问题私密反馈入口，再发布 Release。当前改动与本地 ZIP 不会自动改变远端仓库。

真实多标签并发、完整 API 兼容等功能范围仍以 [当前验收文档](claude-code-gateway.md) 为准；它们不是本轮源码安装工作的完成条件。
