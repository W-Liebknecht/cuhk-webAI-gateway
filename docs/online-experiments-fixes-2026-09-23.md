# 在线实验缺陷修复与复测 — 2026-09-23

## 结果

两批在线实验发现的实现问题已完成修复。实验 1 的系统旁路 409、实验 2 的特殊字符修改与输出格式、实验 3 的跨会话串线、实验 5 的 Ctrl+C 残留、实验 6 附带的多行参数丢失均有针对性改动和回归测试。实验 4、6 主路径原本通过；实验 7 的重启续接由持久网页对话地址补强。

| 问题 | 根因 | 修复 | 复测结果 |
| --- | --- | --- | --- |
| 系统旁路请求重复 409 | 标题/摘要等 `thread_source=system` 请求与前台任务争夺单一网页 | 系统请求等待前台任务释放，并定期清理已退出客户端 | 离线并发回归通过，不再立即制造 409 重试风暴 |
| JSON 特殊字符被破坏、验证失败重复 | 网页模型用正则手工转义 JSON，且没有根据相同 exit code 调整方案 | GLM 工具协议明确要求标准 JSON 解析/序列化、写后逐值读回、相同错误不得盲目循环 | 真实 CLI 修改 `case.json` 后，保留值长度 11、末字符 U+0022、与期望逐字符完全相同 |
| 最终文本出现 `undefined` 或未闭合围栏 | 网页代码块序列化固定使用三反引号，嵌套围栏会提前闭合 | 根据内容中的最长反引号动态选择外层围栏，统一按字面代码输出 | DOM 回归覆盖嵌套围栏、中文、美元符号和无语言代码块 |
| A/B 会话串线 | ledger 只有 CLI digest，没有网页 conversation identity；`--new false` 直接写当前页 | 首轮保存 `https://ai.cuhk.edu.cn/chat/c/<id>`；续话前导航并两次校验地址；旧 ledger 无地址时强制 bootstrap | 真实 A→B→A→B 复测通过；A/B 各自网页均 4 条消息，互不包含对方 nonce |
| Ctrl+C 后 Gateway 卡在 pending tool | 工具调用响应已经返回，原 HTTP 连接结束；Gateway 无法从连接事件得知 CLI 进程退出 | wrapper 启动本地 relay，为请求注入 owner PID；Gateway 每秒检查进程存活，退出后释放 pending call 和 conversation ledger | 真实 70 秒命令运行中 Ctrl+C；随后状态立即为 active 0、pending 0，新任务正常执行 |
| PowerShell 多行 prompt 参数丢失 | `.cmd`/PowerShell/native executable 多层参数重解析 | wrapper 将参数数组写入临时 JSON，由 Node 直接 `spawn` Codex executable；同时保留 stdin 路径 | 真实多行中文 prompt 精确返回标记，并确认 `$`、`"`、`\` 均收到 |
| SSE 错误被 CLI 显示成成功结束 | 已发送 heartbeat 后只发通用 error 事件，Codex 未必把它当成 Responses 失败 | 流式错误同时发出 `response.failed` 和结构化 error | provider 契约测试覆盖失败事件 |
| 空回复恢复缺少网页地址 | 首轮空回复在 `onDelivered` 前失败，ledger 尚未获得 identity | OpenCLI 在确认空回复时返回对话地址；transport 将地址附到 typed error；恢复仍在原对话执行 | adapter 回归覆盖带地址的空回复结果；Gateway 恢复逻辑保留该地址 |
| readiness 在登录过期后仍为健康 | 健康路由只读取本地开关，没有探测 Chrome 页面 | 后台启动探测、每 30 秒及请求前读取真实网页 login/composer 状态；首次探测不阻塞 Gateway 路由注册 | 登录过期时 readiness 变为 503；重新登录后启动约 3 秒完成并报告 `browser_ready=true` |

## 实现范围

- `opencli-adapter/ask.js`：网页对话地址返回、导航和提交前后身份校验、空回复地址回传。
- `opencli-adapter/utils.js`：代码围栏安全序列化。
- `gateway/cuhk-provider/src/transport.cjs`：传递和校验 conversation URL。
- `gateway/cuhk-provider/src/runtime.cjs`：持久 conversation URL、CLI owner PID 回收、系统旁路排队。
- `gateway/cuhk-provider/src/protocol.cjs`：JSON 修改和验证规则。
- `gateway/cuhk-provider/index.cjs`：owner 监视、`response.failed`、非阻塞登录预热与请求前登录校验。
- `bin/cuhk-codex.ps1`、`bin/cuhk-codex-client.cjs`：无损参数转发及客户端生命周期 relay。

## 验证证据

- Provider：78 项回归通过。
- OpenCLI adapter：29 项回归通过。
- 真实会话 A：`01a0c72f-e1fe-7ee2-8281-42b9383246f2`，网页地址 `29e10f88-79bc-474f-ae3b-693a878c2985`，只含 `ALPHA_41C9`。
- 真实会话 B：`01a0c730-4136-7983-9717-482775d6ff09`，网页地址 `a9e652da-2387-4d2f-873c-b53a62196d54`，只含 `BETA_72D8`。
- 中断会话：`01a0c731-da9c-7721-9701-044d97682a31`。Ctrl+C 后 Gateway 为 `active_sessions=0`、`pending_tool_calls=0`。
- 多行会话：`01a0c732-7ceb-7b71-ba2e-90ba6ec66f53`。
- 文件会话：`01a0c735-0adb-7592-878b-c6915c0a568c`。最终 `case.json` SHA-256 为 `79DF62FD22476429CD042F0D12AFBB0B9BBBD78FD4BCEC449068ABDCDFA85E56`。
- 登录恢复后的最终冒烟会话：`01a0cd4d-ea65-7943-a070-6ac96563311b`。CLI 收到 `GATEWAY_FIX_READY`；结束后 Gateway 为 `active_sessions=0`、`pending_tool_calls=0`，readiness 保持 `browser_ready=true`。
- 原始证据目录：`gateway/runtime-state/online-experiments/fix-verification/`。

## 边界

网页侧仍由一个持久 Chrome 会话串行操作。现在可以在多个 CLI 会话间安全切换已有对话，但不表示同时驱动多个独立网页标签页。正在生成的网页回合仍持有独占锁，其他前台任务会得到明确 busy 状态；这是当前单浏览器传输层的设计边界。

## 2026-09-24 补充修复

- 网页提交后 30 秒内未出现对应 user turn 时立即返回“不确定投递”，不再等满总预算，也不自动重发。
- 静默 spinner 只执行一次 Stop；15 秒内仍未停止则明确失败。总网页预算由 15 分钟提高为默认 30 分钟，静默阈值与总预算均通过配置校验并限制上限。
- 启动器改为动态分配 management/gateway/core/backend 四个 loopback 端口，`control.json` 升级为带 `version`、`instanceId`、`startedAt` 和 `ports` 的实例记录。停止时先用实例 token 验证管理端；无法验证的旧记录只清理，绝不依据可能复用的 PID 杀进程。真实重启后端口为动态值，旧 53093–53096 全部释放，Codex wrapper 在线返回“动态端口正常”。
- Responses `input_image` 已贯通：支持 data URL、`file:` URL 和本地 Windows 路径；路径进入文件 API 前统一规范化，错误信息使用 `/` 展示，避免反斜杠被当成文本转义。网页隐藏 file input 的原生选择失败时使用 DataTransfer/React change 备用路径，并等待附件预览确认后才发送。
- GLM 5.3 Flash（本地版）实测会对图片返回 `chat.llm_api.invalid_message`；Gateway 因此把图片轮次自动路由到已在线验证的 `gpt5.6sol`，并在工具续传期间保持该模型。真实路径测试使用 `D:\\Projects\\cuhk-ai-opencli\\extension\\icons\\icon-128.png`，HTTP 200，返回了终端图标及青绿色/深蓝色描述。
- 最终回归：Provider 85 项、OpenCLI adapter 35 项通过；动态端口、真实 Codex wrapper、真实网页图片上传三条在线链路均通过。
