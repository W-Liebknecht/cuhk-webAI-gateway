# 在线实验第二批结果 — 2026-09-22

本批发现的缺陷已完成修复和复测，见 `online-experiments-fixes-2026-09-23.md`。

## 结论

第二批通过真实 `bin/cuhk-codex.cmd` 链路补测四个边界。多文件补丁、21.8 KB 中文上下文、Gateway 重启后的同会话续接通过；客户端在本地工具运行期间中断后，Gateway 未及时释放活动会话，新的独立会话会持续收到 409，判定失败。恢复原 CLI session 可以解除该状态。

| 实验 | 结果 | 核心证据 |
| --- | --- | --- |
| 4. 多文件补丁与本地验证 | PASS | 真实 `apply_patch` 同时更新 parser 并创建文件；验证器 exit 0；验证器自身 hash 未变化 |
| 5. 客户端中断、资源释放与恢复 | FAIL WITH RECOVERY | 子进程退出且没有完成文件，但 Gateway 仍为 `active_sessions=1`、`pending_tool_calls=1`；新会话重试收到 409；恢复原 session 后清理成功 |
| 6. 21.8 KB 中文及特殊字符上下文 | PASS | stdin 传入 300 行、21,830 字节；首、中、末三个标记精确写入 JSON；无 BOM；独立 hash 一致 |
| 7. Gateway 重启后的同会话续接 | PASS，有限范围 | 重启后 ledger 保留 41 个映射；同一 CLI session 在原网页对话续写并准确回忆 nonce |

证据根目录：`gateway/runtime-state/online-experiments/run-20260922-02/`。实验 4–7 第一回合的 Gateway 诊断延续记录在首批 `run-20260922-01/gateway.ndjson`；实验 7 重启后的诊断记录在第二批 `gateway.ndjson`。

## 实验 4：多文件补丁与本地验证

CLI session：`01a0c6fc-965e-77c2-bc98-c100e7c19b1b`。

任务要求读取一个故意错误的 CSV parser，必须使用 `apply_patch` 修复双引号字段、字段内逗号、双引号转义和 LF 输出，同时创建带固定 nonce 的第二个文件，最后运行不可修改的验证器。

结果：

- Codex 事件流产生一个真实 `file_change`，同时更新 `src/parser.cjs` 并创建 `PATCH-NOTE.txt`。
- `node verify.cjs` exit 0，输出 `PATCH_VERIFY_OK 8656854168968d496742def1e85c836e55c88bfbeadaddcc122a22017c6ade2a`。
- 独立复跑仍为 exit 0。
- `verify.cjs` SHA-256 保持 `1EE9AF9AF47295E0A99DADF28F1F7FE2521B206D5DDB58D7ABC8F643AFDF5C80`。
- `PATCH-NOTE.txt` 的最后一个字节为 0x0A，内容与 nonce 完全一致。

补充观察：把多行 prompt 作为 PowerShell 变量传给 wrapper 时，CLI 建立了 session `01a0c6fb-4c30-71b2-b5b2-b704fce119ec`，但网页任务正文缺失，只剩协议和环境信息。单行参数与 stdin 输入均正常。该现象保留为 wrapper 参数传输边界，置信度中等；它不影响本实验的补丁结论。

## 实验 5：客户端中断、资源释放与恢复

CLI session：`01a0c6fd-a3bb-77b3-969b-ed4980a62a50`。

本地命令计划运行约 72 秒，每三秒输出进度。确认 `command_execution` 已开始后对 CLI 发送 Ctrl+C。实际子进程 PID 42944 随客户端退出，启动记录只有一条，没有生成 `completed.txt`。

中断约 48 秒后 Gateway 状态仍为：

- `active_sessions=1`
- `pending_tool_calls=1`
- stage `awaiting_tool_result`
- pending tool `write_stdin`

随后启动一个新的独立 CLI session，Codex 重连一次后仍收到 409：`All target providers failed`。这证明本地进程结束不等于 Gateway 释放当前工具状态；在默认 stale 时限内，其他会话被全局单活动保护阻塞。

使用原 session id 执行 resume 后，回复 `CANCEL_SESSION_RECOVERED`，Gateway 立即恢复为 `active_sessions=0`、`pending_tool_calls=0`。因此当前存在可操作恢复路径，但一般用户不知道必须恢复原任务；如果原任务不可恢复，会长时间影响后续请求。

建议修复：客户端流关闭或 cancel 时，明确取消 pending tool、释放 active session，并把 conversation ledger 标记为需要新网页对话。至少应把 409 改成包含被哪个 session/阶段占用以及恢复办法的 typed error。

## 实验 6：较大中文上下文和特殊字符

CLI session：`01a0c700-9cd5-7a51-b5bd-9d4c021ea0a8`。

通过 wrapper 的 stdin 路径提交 300 行、21,830 字节合成 prompt，标记分布在第 17、149、300 行。中间标记同时包含中文、双引号、美元符号和末尾反斜线。

独立核验：

- `line_count=300`
- `line_017=CTX_ALPHA_17_雪山`
- `line_149=CTX_BETA_149_引号\"美元$反斜线\\`
- `line_300=CTX_OMEGA_300_终点`
- UTF-8 无 BOM
- SHA-256 `C7ACC4905480DE3CA85ABBE0DE69AA5B2CC127954B337C1C42FA4B20A39A4924`

这验证了当前 prompt-file/browser 传输路径能处理约 22 KB 的中文和特殊字符，不代表模型上下文上限。

## 实验 7：Gateway 重启后的续接

CLI session：`01a0c701-8764-7cf2-babb-d94c88dc0769`。

第一回合在网页对话中写入 `RESTART_NONCE_7_D204` 并得到阶段一确认。随后在没有活动任务时正常停止并重启 Gateway；重启后的 runtime session 为 0，但持久 conversation ledger 仍有 41 条映射。用同一 CLI session resume，第二回合返回 `RESTART_STAGE_TWO_OK — RESTART_NONCE_7_D204`。

OpenCLI 只读结果确认当前网页对话含四条消息：阶段一 user/assistant 和阶段二 user/assistant。重启后的 user turn 重新注入完整工具 catalog，而不是轻量 reminder，但没有重放第一轮任务正文。

本实验只证明“浏览器仍停在原页面”时可以跨 Gateway 重启续接。首批实验已经证明页面被其他会话切换后 ledger 会串话，所以这里不能扩大解释为 durable conversation identity 已实现。

## 缺陷优先级更新

1. **P0：多 CLI 会话交替续话写入错误网页对话。** 见首批实验 3。
2. **P1：客户端在 pending tool 阶段中断后，Gateway 不及时释放全局活动状态。** 新会话被 409 阻塞；原 session resume 才恢复。
3. **P2：多行 prompt 作为 PowerShell 参数传入 wrapper 时可能丢正文。** stdin 输入正常，需要用最短独立脚本进一步收敛参数边界。
4. **P2：文件特殊字符修改和结果格式污染。** 见首批实验 2。
5. **P3：系统旁路请求在主任务运行时产生重复 409。** 见首批实验 1。
