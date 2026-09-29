# CUHK Gateway 多标签页并行架构

状态：2026-09-23 设计稿；尚未实现或完成多标签页在线验收。现有单标签页串行路径继续作为回退模式。

## 目标和边界

让不同 Codex 对话在同一已登录 Chrome profile 中各自持有网页标签页，并允许它们同时生成回复、交替调用本地工具。单个对话内的用户消息、网页回复和工具结果仍严格按序执行。这里的“多线程”指多个异步任务和多个独立浏览器页面并发，不要求为每个对话创建 Node worker thread 或 Chrome 进程。

第一阶段只覆盖现有 `/v1/responses`、同一个学校账号及一个 Chrome profile。先以 `maxConcurrentWebTurns=2`、`maxOpenConversationTabs=4` 验证真实并发，再根据页面和学校端的行为调整。账号级并发额度、限流以及模型选择是否跨标签页共享状态，必须通过在线实验确认，不能从扩展层的页面并发能力推断。

## 当前瓶颈

`gateway/cuhk-provider/src/runtime.cjs` 使用单个 `activeSessionId` 拒绝其他对话，`transportTail` 串行化全部 OpenCLI 调用。`cuhk-ai-opencli/src/execution.ts` 将所有持久 `cuhk-ai` adapter 写入固定 session `site:cuhk-ai`；OpenCLI daemon 的写入租约也因此把所有对话视为同一个页面。现有 `conversationUrl` 已能标识学校对话，但每次请求仍需把这一个标签页导航到目标地址。

OpenCLI 的 `Page` 已把页面 targetId 附在后续操作上；扩展以 `(surface, session)` 管理标签页，daemon 以 `(contextId, surface, session)` 管理写入租约，并有不同 session 同时驱动页面的测试。因此首选扩展现有 session 路由，不另建浏览器控制器。targetId/tabId 只用作当前浏览器实例中的辅助身份，不能代替持久的 `conversationUrl`。

## 身份和所有权

```text
Codex prompt_cache_key / client_metadata.session_id
    -> Gateway conversationKey（校验并做哈希）
    -> OpenCLI browserSession = site:cuhk-ai:gateway:<稳定哈希>
    -> 独立的持久标签页 / 页面 targetId
    -> 学校 conversationUrl = https://ai.cuhk.edu.cn/chat/c/<id>
```

- `conversationKey` 是 Gateway 的逻辑所有者；同一 key 的 HTTP 重试必须复用原操作。不同 key 不共享网页页面或 pending tool。
- `browserSession` 由 Gateway 用固定前缀和 `conversationKey` 的 SHA-256 派生，不能直接接受客户端提供的任意 OpenCLI session 字符串。重启后重新计算得到相同名称。
- `conversationUrl` 是学校对话的权威持久身份。首轮发送前分配专属标签页；得到 URL 后才把它和已确认交付的 history digest 一起提交到账本。标签页 ID、targetId、进程 PID、租约 runId 不写入长期账本。
- 每次续话先验证该 browserSession 指向的标签页 URL；标签页丢失时在该 session 下新建标签页并导航到持久 URL，再验证消息列表和当前 URL。验证失败则禁止发送，进入需恢复或新建对话的状态，绝不回退到当前活动页面。
- 同一个逻辑对话在一段时间内最多有一个活跃任务和一个待返回的工具调用；不同逻辑对话可以各有一个。

## 请求流程

```text
Responses 请求
  -> 解析 conversationKey / 幂等 requestKey
  -> 进入该 key 的 FIFO 队列（同 key 串行）
  -> 有网页回合时申请全局网页槽位（不同 key 可同时获槽）
  -> OpenCLI 用该 key 的 browserSession 获取专属标签页
  -> 验证 URL、发送一次、监听该页完整回复
  -> 释放网页槽位；持久化已确认交付状态
  -> 如需工具，向所属 Codex 返回 call_id，等待工具结果
  -> 工具结果按 call_id + conversationKey 校验后再次申请网页槽位
```

等待本地命令、`write_stdin` 轮询或用户输入期间，任务保留对话所有权和标签页，但不持有网页生成槽位。进度查询仍从 Gateway 的状态直接回答；同一对话的补充指令排入该对话队列。系统标题/摘要请求使用低优先级队列，不能抢占已有前台网页回合，也不能让一个繁忙对话阻塞全部其他对话。

运行时建议改为 `activeByConversationKey: Map<key, session>`、`transportQueues: Map<browserSession, Promise>` 与一个公平的全局信号量。创建任务、认领工具结果、更新 pending call 和完成任务的状态转移，必须在同一 key 的锁内完成；只把真正的网页写入放到异步槽位中。`pendingCalls` 继续按 call_id 索引，同时验证所属 key 和 owner PID，防止 A 的工具结果续写 B。不要把单个 `transportTail` 换成无界 `Promise.all`。

## OpenCLI 改造

为持久 adapter 命令增加明确的内部 session 参数，例如 `--browser-session`，仅 Gateway 的 `ask` 路径使用。OpenCLI 执行层将其传给 `browserSession(...)`、daemon 租约和扩展，替代固定 `site:cuhk-ai`。参数要做长度与字符校验，限定 `site:cuhk-ai:gateway:<hash>` 命名空间；普通用户未传参时保持当前行为。`ask` 在所有 `goto`、DOM 读取、提交、回复监听步骤都绑定该 session 的 Page，不使用“当前活动标签页”查找。首轮同样要在分配标签页后再打开聊天主页。

需要确认 daemon 和扩展在同一 profile 中对不同 session 的命令可以并发，不把整个 browserSession callback、网络监听器或 `selectModel` 设置隐式串行化。`status` 健康探测改用独立只读 session（或已有页面的只读聚合），避免探测误触任一正在生成的对话页面；总体 readiness 还应报告登录、daemon/扩展连接及可用网页槽位。登录失效可影响全 profile，但不得抹掉各对话的持久 URL。

## 有界调度和资源回收

- 初始上限：2 个同时运行的网页生成回合、4 个受管对话标签页、每 key 至多 1 个网页写入。队列有长度和等待时限；满载时返回明确的 `busy`/`retry_after`，不静默丢请求，也不启动第二次相同写入。
- 使用 FIFO 并给前台请求优先级；等待工具结果不占槽位。新任务不能永久饿死：同一 key 连续续话后重新排到公平队列尾。状态接口给出 running、queued、awaiting_tool_result 数量和每项等待时长，但不暴露 prompt、学校账号或完整 URL。
- 有界保留闲置标签页。只回收没有生成、没有 pending tool、没有未确认交付的标签页；保留账本中的 `conversationUrl`，下次按同一 browserSession 重建。扩展租约和 Gateway 状态都需确认页面已停止后才能回收。
- Ctrl+C 或 owner PID 消失：已返回工具请求的对话只释放该 key 的 pending call；网页写入中的对话标记断连，待该页面操作结算后再处理。其他 key 不受影响。
- 超时或网络结果未知：该标签页及 key 进入 `uncertain`/quarantine，不能自动重发提示；先按 conversationUrl 只读核对用户消息和回复。无法核对时返回明确失败并要求新对话或人工检查。全局槽位可在底层操作真正结束后释放，不能因 HTTP 超时过早释放页面所有权。
- Chrome/扩展重启：账本保留 URL 和 digest，浏览器 session 名可重算；重新获取页面租约并验证身份。只恢复已确认交付的回合；旧 targetId 不作为恢复依据。

## 持久化和状态迁移

当前 `conversations.json` 已有 URL/digest，可增加版本字段及 `browserSession` 派生策略版本，不必保存真实 tabId。迁移旧记录时，只要 URL 合法就按 key 分配新标签页并验证；无 URL 的旧记录按现行规则重新 bootstrap。保存采用原子替换；同一 key 的已确认交付状态按顺序更新。并发写不同 key 时由单一持久化队列或小型事务层串行落盘，避免两个 JSON 全量写互相覆盖。若持久化失败，不能把未记账的网页写入当作安全可续话；该 key 应进入 `uncertain`，并暴露诊断。

## 分阶段落地

1. **OpenCLI session 路由**：添加内部 session 参数，覆盖参数校验、daemon 租约分区、扩展标签页分配/关闭，以及标签页丢失后按 URL 重建。先在无模型调用的页面 fixture 中验证 A/B 页面互不影响。
2. **Gateway 状态机**：将全局 active 与锁换成每 key 所有权和有界调度；保留 HTTP 幂等、工具 call_id 归属、owner PID 回收和原对话空回复恢复。加入状态快照与容量配置。
3. **在线并发实验**：两条独立对话同时提交各自 nonce，证明两个网页回合真实时间重叠，并在网页回读中确认互不串线；其中 A 运行长工具时 B 必须能完成网页回复。
4. **故障实验和灰度**：在 A 生成时 Ctrl+C、关闭 A 标签页、重启 Gateway/Chrome、制造一个未知交付结果；B 应继续完成且 A 不重复写入。验证学校账号并发限制和模型设置是否互相污染。先启用 2 槽，保留配置开关可退回单标签页串行模式。

## 验收标准

| 场景 | 必须观察到的结果 |
| --- | --- |
| A、B 同时提问 | 两个 browserSession / tabId 不同；网页提交与生成时间区间重叠；各自只出现自己的 nonce |
| A 等待本地长命令，B 发起新对话 | B 可完成；A 的原进程只启动一次，工具结果仍回 A 的网页对话 |
| A、B 同时续话与 HTTP 重试 | 同一 key 的网页写入串行、重试只附着原操作；不同 key 可同时运行 |
| 错投工具结果 | call_id 或 conversationKey 不匹配时拒绝，任何页面都不新增消息 |
| 关闭 A 标签页或中断 A CLI | A 按 URL 安全重建或进入隔离；B 页面、pending tool 与回复不受影响 |
| Gateway/Chrome 重启 | 已确认交付的 A/B 各自续接原 URL；未知交付不自动重发 |
| 达到并发和标签页上限 | 请求有界排队或明确 busy；状态显示容量和排队时长，不出现全局 409 风暴 |

实验记录应同时采集 Gateway request/session/slot 事件、OpenCLI session 与 targetId、网页 URL 和消息数，以及两个 Codex CLI 的时间线。日志只保留哈希身份与必要时间戳；测试用 nonce 可记录在受限的实验目录，不写入常规运行日志。
