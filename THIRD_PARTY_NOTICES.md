# 第三方组件与署名

本仓库的 [MIT 许可证](LICENSE) 只适用于本仓库贡献者有权授权的原创内容。其他项目和服务仍由各自的条款约束。

| 组件 | 本项目中的用途 | 上游许可证 | 来源 |
| --- | --- | --- | --- |
| OpenCLI (`jackwener/opencli`) | 本地 Chrome 桥接与学校网页适配器的运行时；安装程序按固定提交打包 | Apache-2.0 | [仓库](https://github.com/jackwener/opencli)、[许可证](https://github.com/jackwener/opencli/blob/main/LICENSE) |
| Claude Code Router (`musistudio/claude-code-router`) | 本地 Gateway 宿主；安装程序按固定提交打包 | MIT | [仓库](https://github.com/musistudio/claude-code-router)、[许可证](https://github.com/musistudio/claude-code-router/blob/main/LICENSE) |
| Node.js | 安装程序中的独立 JavaScript 运行时 | Node.js 许可证及所列第三方条款 | [许可证](https://github.com/nodejs/node/blob/v24.19.0/LICENSE) |
| Python | 冻结控制面板所用运行时 | Python Software Foundation License 等 | [许可证](https://docs.python.org/3/license.html) |

本仓库没有把上述项目的源码或构建产物作为 Git 文件提交。Windows 安装程序的构建会从锁定提交取得上游源码，保留其 LICENSE/NOTICE 和 npm 包自带的许可证文件，并随包放入 Node 与 Python 许可证。表格不是 npm 传递依赖的完整清单。

源码发布包不包含第三方运行时；用户通过 setup 按 `dependencies.lock.json` 下载上游原始仓库，其 LICENSE/NOTICE 保留在依赖目录中。setup 同时生成 `.dependencies/dependency-inventory.json`，列出实际安装的 npm 包名、版本和声明许可证。安装程序包含这些依赖，因此首次公开发布前还需要检查完整清单中的未声明及特殊许可证，并确认所需法律文本都已随包保留。

Codex CLI、Claude Code CLI、Chrome 和 CUHK AI 网页由各自提供者管理；本仓库的 MIT 许可证不涵盖它们，也不代表这些提供者授权或认可本项目。用户应自行安装客户端，并使用本人获准访问的学校账号。
