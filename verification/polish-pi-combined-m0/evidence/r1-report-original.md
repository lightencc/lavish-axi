# Pi M0 恢复与同步补证报告

日期：2026-10-30。产品契约维持 [v1.2](polish-development-spec.md)；隔离验证机制版本 **r1.1**，方案见 [CONTRACT.md](../verification/polish-pi-recovery-m0/CONTRACT.md)，最终代码哈希见 [code-version.json](../verification/polish-pi-recovery-m0/evidence/code-version.json)。**完整 Pi M0 仍未通过，不进入 M1–M3。**

本轮没有监听网络端口，没有修改 49791／49792，没有运行网页测试，没有改动生产源码或已安装 Pi，没有新增权限、远控、凭据、上传、提交、推送、部署。只使用项目隔离文件、自有子进程管道与两条全新标记的 Pi 组件消息。所有历史未知消息，包括上一轮最后两条崩溃记录，均未重投。

## 1. 证据勘误与历史保全

已追加 [网页报告勘误](polish-pi-web-m0-errata.md)，原图片、报告和清单均保持不动：

- 两张 PNG 哈希相同，只能计作同一画面的一份证据；忙碌排序依据是浏览器 JSON 和宿主事件。
- 旧测试页刷新后评论列表清空是该验证工具的已测失败，不是尚未实现的正式产品回归。
- 旧工具没有 ending 和跨 poll 裁决，因此这些子项是未实现而 **NOT RUN**，不能写成对应故障实验已执行失败。

原网页报告 SHA-256 为 `a366f6a5e0eb0c45c87414a7b126d8b50fb6e63798e6d2e1e0f4288dfc07498d`；本轮保存了独立快照。所有前轮 manifest 条目另作前后哈希核对。

## 2. 最小机制改变了什么

| 模块 | 本轮实现 | 明确的边界 |
| --- | --- | --- |
| [authority.js](../verification/polish-pi-recovery-m0/authority.js) | 原子持久状态、单写者、消费代次、bridge／poll 共用 claim、投递 attempt、unknown、固定结束集合 | 仅隔离协调器；未接入生产 lavish poll。内部回执只可由受信宿主适配器提供，不是浏览器可声明的事实 |
| 同上：接管 | supervisor 必须持有自己创建且实际退出的 ChildProcess，旧锁 PID／nonce 均匹配；恢复后递增代次，拒绝旧 token | 不根据 lease 到期或 PID 查询猜测可接管；恢复过程再崩溃时仍可能需人工处理，不能声称完整高可用 |
| [drain.js](../verification/polish-pi-recovery-m0/drain.js) | 无浏览器连接也可继续 accepted 批次；遇 host_queued／unknown 停止；结束标记最后消费，全部真实输入回执才 ended | 排空测试使用明确标注的宿主替身；真实 Pi 的整个 final batch 尚未验收 |
| `Replica` 与订阅 | 先订阅再取快照；持久 version；重复去重、乱序缓存、缺口请求新快照、旧连接拒绝、epoch 切换先快照 | 内存通道／本地文件验证，没有 WebSocket／网页重连证据；旧代次回复归档尚未实现，本轮验证的是拒绝覆盖新状态 |
| [receipt.js](../verification/polish-pi-recovery-m0/receipt.js) | 只读核对宿主 receipt → 确切输入与回复条目，恢复缺失的 sidecar 关联 | 缺 receipt、引用不全、跨身份、顺序异常或歧义一律 unknown；不以正文或相邻记录补猜 |
| [receipt-extension.js](../verification/polish-pi-recovery-m0/receipt-extension.js) | 公开 Pi 扩展记录 `context_with_system`，在 turn_end 后写结构化宿主 receipt | 回复已经先于扩展落盘，二者不是原子事务；不能由 appendEntry 返回值直接宣称完成 |

本地 accepted、宿主持久接纳、处理输入和模型完成仍为不同事实。接管只改变消费权，不改变外部调用的不确定性。状态恢复后，未派发的 accepted 可以首次领取；dispatching／host_queued 转 unknown，不能再次领取。已见输入但未见回复保留 delivered 事实，并标记 executionUnknown，不能伪装已完成。

消费模式切换在存在未决投递时拒绝；允许切换时递增代次，使旧 token 不能继续写入。迟到的正向事实只能经可信适配器按原 binding、epoch、message、digest、attempt 核对，不是沿用过期写权限。

## 3. 分层测试结果

### 本地机制与故障替身：23 项通过

[final-tests.txt](../verification/polish-pi-recovery-m0/evidence/final-tests.txt) 包含完整结果和实际子进程 PID／状态诊断：

- 12 项状态／同步测试：claim 先持久化、重复／异载荷、unknown 停止、结束固定集合、持久重启、模式／评审代次隔离、回执身份校验、订阅快照交界、乱序／重复／旧连接、重连恢复 reply／ended、跨 epoch 保护。
- 4 项真实本地子进程测试：分别在 accepted、dispatching、ending 后 SIGKILL 自有写者并接管；两条消费子进程经同一协调器竞争，只有 bridge 被当前模式授予一次 claim。这里的 poll 是 IPC 消费者替身，**不是原生 lavish poll 进程**。
- 3 项宿主历史查询测试：receipt 存在时恢复确切回复；缺失、错误或歧义时不恢复。这部分使用构造的历史条目，不能独立作为 Pi 证据。
- 4 项排空测试：固定最终集合和 marker 顺序；queued 不结束；调用不确定后不重试；订阅抛错不影响已持久结束状态，新快照可恢复。宿主均为显式替身。

所有本地变更在同一同步事务中持久化事实、version 和快照事件；传输通知在持久化后发生。写入失败会停止该权威实例继续服务。本轮未注入磁盘损坏、断电、恢复过程自身的二次崩溃，也未测试所有进程／内核锁组合，不能扩大故障覆盖范围。

RED 日志、初次语法／错误优先级失败及后续修正均保留。这些属于验证代码开发过程，不归因于 Pi。最终所有 23 项通过。

### 真实 Pi 组件：两个不同窗口

使用已安装 Pi 1.4.0 公开 API；每个实验仅一条新消息、一个明确命名的自有实例，禁用工具、MCP、其他扩展及项目上下文。没有网页路径，没有恢复宿主进程，没有重放输入。模型沿用现有配置；历史只导出身份和最终文本，不导出模型思考。

| 窗口 | 实例／消息 | 实际结果 |
| --- | --- | --- |
| 宿主 reply 和 receipt 已落盘，sidecar 尚无回复关联 | PID 27647；session `01a18cd4-7b75-77a4-8001-02c304697a34`；消息 `r1-a61c11ae-3824-4904-8063-fead91cdb9ab` | 在明确 checkpoint SIGKILL 自有 Pi；只读找到带原身份／attempt 的 receipt，核对输入及 assistant entry，sidecar 从无回复关联恢复为 replied；0 重投 |
| 宿主 reply 已落盘，receipt 尚未写 | PID 27697；session `01a18cd4-8408-733c-8920-67ee83e3c60e`；消息 `r1-a81fc59b-b833-44c0-8755-659a97874379` | 在 reply-before-receipt checkpoint SIGKILL；磁盘确有 assistant 回复，但没有结构化关联凭据；恢复查询返回 unknown，保留 delivered + executionUnknown；0 重投 |

证据：[原始事件](../verification/polish-pi-recovery-m0/evidence/pi-window-events.jsonl)、[receipt 存在结果](../verification/polish-pi-recovery-m0/evidence/pi-receipt-result.json)、[receipt 缺失结果](../verification/polish-pi-recovery-m0/evidence/pi-gap-result.json)、[清理及断言](../verification/polish-pi-recovery-m0/evidence/cleanup-and-assertions.json)。这两条结果没有被合并为“恢复已通过”。第二条现在也是必须保留的未知结果，今后不得盲重投。

真实 Pi 实验发生在 r1.1 最后一项“拒绝缺失 attempt 的回执”守卫收紧之前；两条实跑记录都带已持久的合法 attempt。最终守卫经独立 RED→GREEN 测试验证，没有为了代码哈希变化重跑模型或重投消息。其余真实窗口相关扩展／查询代码未变，原始事件不覆盖。

## 4. 剩余的原子性限制

安装版 `agent-session.js` 先解析已经持久化的 `messageEntryId`，再调用 `turn_end` 扩展，之后才提交扩展返回的 boundary entries。`session-manager.js` 对条目分别追加。公开 boundary entries 也不能把先前的 assistant 写入与后来 receipt 变成同一事务。

因此，新增宿主 receipt 能消除 **receipt 已保存、sidecar 未保存** 的特定窗口，但无法消除 **reply 已保存、receipt 未保存** 的窗口。后者由本轮真实崩溃复现，而非只有理论推测。宿主调用发生但没有任何可核验记录的窗口也仍未解决。[安装版来源哈希](../verification/polish-pi-recovery-m0/evidence/pi-source-manifest.json)

可选设计及影响：

1. **保留 v1.2 的全部保证。** 需要宿主提供持久 turn／attempt 身份、权威状态查询及可验证的恢复／幂等协议，或在受支持的宿主实现中将关联写入纳入同一持久边界。还必须验证工具副作用和“调用发生、回执未存”的窗口；加一张本地表不能代替这些保证。此路径需要独立设计与授权，不修改本机安装版来凑通过。
2. **接受无法自动解除的 unknown。** 当前方案可以保留证据、安全停止、人工核实，但完整恢复门槛仍不通过。若产品选择这种降级，须明确变更需求；本轮没有自行采用。

另起会话或重放历史不是满足当前 session 绑定的替代方案，也不在本轮执行范围内。

## 5. G01–G07 状态与证据级别

| 门槛 | 本轮结论 | 已测／未测的区别 |
| --- | --- | --- |
| G01 既有 session 的网页链路 | **沿用前轮受控正常路径证据；本轮网页 NOT RUN** | 新机制没有网页接入证据；两个新 Pi 只验证各自窗口，不能冒充原活动实例恢复 |
| G02 自动处理 | **沿用前轮正常路径；恢复后的真实 Pi 队列 NOT RUN** | 本地 accepted 恢复可领取、替身排空通过；未验证接管后自动送入仍活动 Pi 的完整路径 |
| G03 回执身份分离 | **真实 Pi 窗口子项 PASS；新链路整体 NOT RUN** | 输入事件和持久回复凭据有明确身份；没有新增真实宿主排队恢复或网页状态证据 |
| G04 不确定性恢复 | **完整门槛未通过；receipt 缺失窗口已测仍 unknown** | receipt 已存窗口成功恢复；缺失窗口不能安全解除，不能用前者覆盖后者 |
| G05 所有权、恢复及唯一消费 | **本地机制 PASS；完整宿主／原生 poll 集成 NOT RUN** | 自有进程退出证据、代次隔离、共享协调器通过；真实宿主接管、原生 poll 并发和恢复中再崩溃未验收 |
| G06 ending 与无漏同步 | **本地机制 PASS；真实 Pi／网页端到端 NOT RUN** | 替身排空和本地快照事件通过；不能由此声称正式结束、WebSocket 重连或网页刷新已实现 |
| G07 性能 | **本轮 NOT RUN** | 保留前轮 30 次网页样本及限制；本轮不把本地测试用时当产品性能 |

这是“已测局部通过／已测仍未知／尚未实现或未测”的分层结论，不是把缺失证据统称实现失败。完整 Pi M0 仍不满足 v1.2；Codex 保持后置。

## 6. 清理、版本与剩余计划

两条 Pi 及最终故障测试产生的自有子进程均已退出；49793 未监听，原型 49791／49792 保持原 PID。本轮不使用或延长上一轮的监听许可。清理与完整性见 [cleanup-and-assertions.json](../verification/polish-pi-recovery-m0/evidence/cleanup-and-assertions.json)、[manifest.json](../verification/polish-pi-recovery-m0/evidence/manifest.json)。

下一步先独立审证 r1.1 的局部机制和 Pi 能力边界，再决定如何获得宿主的权威恢复协议。之后才验证“本地接管 → 同一仍活动 Pi → 正向查证／继续安全 pending”的组合，以及真正的 poll 适配和 final batch。不能先靠网页重试掩盖宿主缺口。

未来网页验证的最小候选范围：单一 `127.0.0.1:49793`，一个预先启动并记录身份的专用 Pi；仅 `/binding`、`/submit`、`/query`、`/snapshot`、同端口 `/events` 和 `/end`，最多 10 分钟，退出核对自有进程及端口释放。这只是后续接口计划，尚未实现或申请启动；必须由父任务另取许可，不能沿用旧批准。

本轮止于 **Pi M0 补证**，交付方案、局部机制、分层证据和限制；不自行放行 M1–M3。
