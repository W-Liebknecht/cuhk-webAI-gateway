# 本轮发布准备改动说明

本轮把已有功能包装成可按文档准备的 Windows 源码项目。没有修改模型提示编译、会话状态机、重试策略、工具验证或 CLI 权限设置；改动集中在入口发现、依赖加载、安装脚本、分发配置与文档。下面列出相对上一轮文档整理新增的改动，供维护者审阅。

## 启动与依赖加载

| 文件 | 改动 |
| --- | --- |
| `bin/runtime.ps1`、`bin/node-run.ps1` | 共享 Node 发现：显式 `CUHK_NODE_EXE` → PATH → 已有 Codex 附带运行时；缺失时提示安装。初始化配置仅在文件不存在时复制示例 |
| `bin/cuhk-gateway.cmd`、`bin/opencli.cmd` | 去掉维护者的绝对路径；OpenCLI 显式使用本仓库适配器入口 |
| `bin/bridge-paths.cjs` | 支持 `.dependencies/opencli`，继续优先旧同级目录；保留 `CUHK_OPENCLI_ENTRY`；加入非覆盖配置初始化 |
| `bin/cuhk-gateway.cjs` | CCR 保留旧路径和显式覆盖，增加 `.dependencies/claude-code-router` 后备路径；启动时初始化缺失配置 |
| `gateway/cuhk-provider/index.cjs` | 默认健康探测改用 `bin/cuhk-opencli.mjs`，新安装无需上游目录中的 CUHK 联接；已有显式配置与关闭探测选项保留 |
| `opencli-adapter/_opencli.js`、`utils.js` | Turndown 及 GFM 从选定 OpenCLI 的依赖解析；Markdown 转换规则和调用逻辑不变，运行时不再依赖适配器的 node_modules 联接 |
| `bin/cli-discovery.cjs`、`cuhk-codex-client.cjs` | 原有桌面 Codex 发现仍优先；增加 PATH 原生程序、官方 npm 包原生程序和显式 `CUHK_CODEX_EXE`。继续原生 spawn，保留多行参数与请求所有权转发 |
| `bin/cuhk-codex.ps1` | 使用共享 Node 发现；provider 参数、隔离 home 与权限设置保留 |
| 两个 `*-launch.ps1` | 启动前初始化缺失配置；已有配置和会话启动行为保留 |
| `CUHK-AI-Settings.cmd` | 继续优先 pyw，增加 pythonw 后备与明确的缺失提示 |

## 安装、配置与源码包

- `dependencies.lock.json`：固定两个公开上游提交；不依赖维护者未发布的 OpenCLI 提交。
- `scripts/setup.ps1`：按锁定版本下载和构建；拒绝不同版本、非 Git 目录和源文件修改，不重置现有 checkout。允许正常构建产生的指定 manifest/扩展/UI 元信息文件变化。必要的测试依赖联接仅在缺失时创建。
- `scripts/check-install.cjs`：检查 Node、适配器、扩展、SQLite、Python/Tkinter；客户端显示选用状态，不发送模型任务。
- `scripts/dependency-inventory.cjs`：生成实际 npm 包元信息清单，不包含本地对话或账号信息。
- `config.example.json`、`.gitignore`：本地配置与安全模板分开，依赖与发布产物也被忽略。Git 中的 `D config.json` 表示仅退出跟踪；你电脑上的原文件仍在，字节未变。
- `.gitattributes`、`scripts/build-source-release.ps1`：源码 ZIP 与 Git archive 排除本地配置、记忆和运行时数据；自定义打包脚本附 `SOURCE-MANIFEST.json`，拒绝覆盖现有 ZIP。源码包不包含第三方运行时，安装时保留其原始许可证。
- `scripts/test-adapter.cjs`、`distribution.test.cjs`：提供当前 checkout 的测试入口，加入配置非覆盖、旧/新依赖发现、无桌面 Codex 的 npm 安装回归。

退出跟踪和 ZIP 排除不会重写历史 Git 提交。本轮没有推送、发布 Release、改远端可见性，也没有修改其他任务对 `memory/` 的既有改动。

## 文档同步与验证

新增 [安装指南](install.md)，更新 README、发布清单、第三方说明、支持/贡献指南、项目分享文案和测试命令。安装指南列明扩展的广泛权限，给出更新、停止、卸载与自定义路径方法。

验证：Provider 175/175、主仓库适配器 45/45、面板 10/10、真实 Claude CLI 离线工具闭环、双客户端版本入口、独立上游下载/构建、独立 Gateway 浏览器就绪及停止、源码包内容检查、JS/PowerShell 语法、文档链接与 diff 检查均通过。验证边界和剩余工作见 [发布准备清单](release-readiness.md)。
