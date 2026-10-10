# 第三方组件与署名

本仓库的 [MIT 许可证](LICENSE) 只适用于本仓库贡献者有权授权的原创内容。其他项目和服务仍由各自的条款约束。

| 组件 | 本项目中的用途 | 上游许可证 | 来源 |
| --- | --- | --- | --- |
| OpenCLI (`jackwener/opencli`) | 本地 Chrome 桥接与学校网页适配器的运行时；当前另行检出，未打包进本仓库 | Apache-2.0 | [仓库](https://github.com/jackwener/opencli)、[许可证](https://github.com/jackwener/opencli/blob/main/LICENSE) |
| Claude Code Router (`musistudio/claude-code-router`) | 本地 Gateway 宿主；研究检出位于被 Git 忽略的 `research/claude-code-router/` | MIT | [仓库](https://github.com/musistudio/claude-code-router)、[许可证](https://github.com/musistudio/claude-code-router/blob/main/LICENSE) |

本仓库没有把上述两个项目的源码或构建产物作为 Git 文件提交。将来制作安装包时，必须按实际包含的组件重新生成第三方依赖清单，并随包保留相应的许可证、版权与必要的修改说明。这里的表格不是 npm 传递依赖的完整清单。

源码发布包不包含第三方运行时；用户通过 setup 按 `dependencies.lock.json` 下载上游原始仓库，其 LICENSE/NOTICE 保留在依赖目录中。setup 同时生成 `.dependencies/dependency-inventory.json`，列出实际安装的 npm 包名、版本和声明许可证。它是包元信息清单，不是完整法律审计；若未来把这些依赖打进二进制安装包，需要逐项核对未声明或特殊许可证并随包保留完整法律文本。

Codex CLI、Claude Code CLI、Chrome 和 CUHK AI 网页由各自提供者管理；本仓库的 MIT 许可证不涵盖它们，也不代表这些提供者授权或认可本项目。用户应自行安装客户端，并使用本人获准访问的学校账号。
