# 在线实验首轮结果 — 2026-09-22

后续四个边界实验见 `online-experiments-results-2026-09-22-batch-2.md`。
缺陷修复及真实复测见 `online-experiments-fixes-2026-09-23.md`。

## 结论

三个实验均已通过真实 `bin/cuhk-codex.cmd` 链路执行，实际经过 Codex CLI、CCR、CUHK provider、OpenCLI、Chrome 和学校 GLM 5.3 Flash/high。实验 1 的长进程主路径通过；实验 2 最终文件正确，但暴露了特殊字符转义和输出格式问题；实验 3 明确复现网页会话串话，判定失败。

| 实验 | 结果 | 核心证据 |
| --- | --- | --- |
| 1. 长命令、进度询问与追加要求 | PASS，附带旁路 409 缺陷 | 85 秒扫描只启动一次；PID 39360；18/18；count 2000；exit 0；receipt 在 launch、scan-result、summary 三处一致；会话续接成功 |
| 2. 文件、多轮上下文与失败修正 | PASS WITH DEFECTS | 6 个真实 CLI 回合；最终 validator exit 0；特殊文本 81 字节、无 BOM、4 个 LF、0 个 CR；SHA-256 `19C6DE...F897`；中途发生可复现转义破坏 |
| 3. 两个独立 CLI 会话竞争 | FAIL | A 长任务运行时 B 成功进入网页；随后在 B 网页对话中直接出现 A 的 `A续话2` 和 `A_NONCE_7F21` |

证据根目录（gitignored）：`gateway/runtime-state/online-experiments/run-20260922-01/`。测试期间 Gateway 一直保持启用，模型为 `glm5.3flash`、思考强度为 `high`。

## 实验 1

真实交互式 TUI 会话：`01a0c4df-9fe1-7e33-807a-7e5eb34ba4e1`。

CLI 只启动了一次 `online-long-scan.ps1`。脚本每五秒扫描一次 2,000 个合成文件，共 18 步。运行中提交“现在进度如何”，TUI 明确显示消息将在下一次工具调用后提交；下一次续读后返回 step 8/18、PID 39360、同一进程 session id 和 stderr checkpoint。随后提交写入 `summary.json` 的要求，原进程完成后该要求执行一次。

独立核验：

- `launches.ndjson` 只有一条记录；launch、scan-result、summary 的 PID 均为 39360。
- 三处 receipt 均为 `1fb756cc8b06447e9d32e5154b2d68ef`。
- `scan-result.json`：count 2000、exitCode 0。
- `summary.json` SHA-256：`59AF48D3FBBE4864F6D8DE856B0B6BA78DDDF3C03613E7189F868CB7054088D9`。
- 退出 TUI 后用同一 session resume，准确返回 `SESSION_STILL_USABLE_39360`。

附带缺陷：主会话工作期间，真实 TUI 产生三个 `thread_source=system` 的独立会话键；每个请求重试一次，两次均收到 409。主任务未失败，但系统旁路请求会制造错误噪声和无效重试。需要进一步辨认这些请求属于标题、摘要还是其他内部任务，并决定 Gateway 是快速跳过、排队还是允许文本只读执行。

## 实验 2

真实 CLI 会话：`01a0c4e4-4951-7e73-a9d9-d1807cfc46ba`。

最终独立核验：

- `case.json`：case_id `CASE-20260922-ALPHA`、status `corrected`、revision 2。
- `locked_value` 长度 13，最后一个字符 U+0022。
- `online-case-validator.ps1` 最终 exit 0，输出 `ONLINE_CASE_VALID`。
- 禁止工具的记忆回合准确回忆 case_id、长度、U+0022、status、revision、exit 7 和 exit 8。
- `special.txt`：81 字节、UTF-8 无 BOM、LF=4、CR=0、末字节 0x0A，独立 SHA-256 与 CLI 报告一致。

发现两个缺陷：

1. 首轮没有写入要求的末尾 U+0022，却声称“四个字段及值均符合要求”。第二轮逐字符读回已经显示只有 12 个字符，模型仍把问题误解为“JSON 文件是否以双引号结尾”，再次错误声称没有丢失。
2. 修正 status 时，模型用手工正则转义重写 JSON，把已正确的 13 字符 `locked_value` 变成 15 个字符。验证器连续五次 exit 8，脚本没有依据相同错误调整；模型随后才另起一次工具调用，改用 `ConvertTo-Json` 恢复并通过。这说明文件存在、命令 exit 0 或最终状态正确都不足以证明中间修改安全。

最终回答还出现多余的 `undefined` 和未闭合的 Markdown 围栏；文件本身正确，属于结果格式污染。

## 实验 3

A 会话：`01a0c4ea-568e-7fa1-a8a3-d948edd05199`，标记 `A_NONCE_7F21`。B 会话：`01a0c4ea-ccfe-7c00-9b9d-8f178771f4fe`，标记 `B_NONCE_94C3`。

A 的本地长进程运行约 55 秒时启动 B。B 没有被拒绝或排队，约 28 秒内创建自己的 `result.json` 并完成。A 随后也完成，两个本地目录和最终 CLI 文本均只包含各自标记。

但是网页隔离失败。先执行 B 续话，再执行 A 续话后，使用 OpenCLI `cuhk-ai read` 只读回当前网页对话，得到以下顺序：

1. B 的完整 bootstrap，包含 B 工作目录、B 初始任务、`B_NONCE_94C3` 和 `B续话1`。
2. assistant 返回 `B_SESSION_MARKER=B_NONCE_94C3`。
3. 同一网页对话中的新 user turn 是 A 的工具协议和 `A续话2`，包含 `A_NONCE_7F21`。
4. assistant 返回 `A_SECOND=A_NONCE_7F21`。

这证明 Gateway 的 conversation ledger 只能判断“该 CLI 会话以前建立过网页对话”，不能确认当前活动网页仍属于该会话。`--new false` 会把 A 的增量写进当前打开的 B 对话。CLI 表面结果恰好正确，是因为 A 的续话包含了答案标记；不能据此判定隔离成功。

该缺陷优先级最高。修复前，多 CLI 会话即使不同时向浏览器写入，只要交替续话也不安全。应先实现可恢复的网页 conversation id 或续话前的页面身份校验；无法校验时应放弃 ledger 并 `--new true`，而不是盲目复用当前页面。

## 实验基础设施

新增两个可重复使用的受控夹具：

- `gateway/cuhk-provider/test/fixtures/online-long-scan.ps1`
- `gateway/cuhk-provider/test/fixtures/online-case-validator.ps1`

Gateway 启动脚本支持可选环境变量 `CUHK_ONLINE_DIAGNOSTIC_PATH`。只有明确设置时才记录测试请求、网页提交和结果；默认运行不启用。诊断记录不包含认证头。网页提交/返回现增加 runtime session id，以便后续并发实验把 request、session 和 browser turn 精确关联。

首轮测试已停止继续写入网页，Gateway 保持运行，便于后续修复和定点复测。
