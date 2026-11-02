# Pi M0 同一活动实例组合补证报告

日期：2026-10-30。产品开发书仍为 **v1.2**；本轮隔离机制版本 **r2**。方案见 [CONTRACT.md](../verification/polish-pi-combined-m0/CONTRACT.md)。**局部组合通过，完整 Pi M0 仍未通过，不进入 M1–M3；Codex 保持后置。**

“整体提交不关联网页元素”已在正式开发书 §3.2、§8.1 和 A07 规定：会话级输入无虚构 selector，无元素描边或锚定圆球，回复经整体意见入口查看。原有原型未在本轮改造；新准备的 M0 网页接口会拒绝整体提交里的 selector，不能将此等同于正式交互已完成。

## 1. 语义勘误和证据保全

新增 [r1.1 语义勘误](polish-pi-recovery-m0-errata.md)，没有覆盖旧报告：

- `delivery_unknown`：输入消费无法证明，适用 §7.5／G04，禁止盲重投。
- `delivered + executionUnknown`：消费已证明、回复关联未知，适用 §8.1，禁止猜测回复；单凭此不判 G04 投递恢复失败。
- §6.2 的 ended 以固定集合及 marker 全部真实消费为准，不等待模型回复或 HTML 修改。

前轮 134 条 manifest 条目在本轮前后哈希全部相同，r1.1 报告另存快照。没有重投任何历史 unknown。没有修改生产 src、已安装 Pi、旧验证目录和 49791／49792 原型；没有新增监听、远控、权限、凭据、上传、提交、推送或部署。

## 2. 真实 Pi：始终同一个进程与会话

| 身份 | 实际值 |
| --- | --- |
| Pi | 1.4.0；PID **69225** |
| instance | `db4f2201-489d-474f-87ad-3806b5cb0616` |
| session | `01a18cea-912f-77bc-a657-4fbd1c58fe9a` |
| coordinator | PID 69248 → 69291 → 69942 |
| 自有运行目录 | `verification/polish-pi-combined-m0/runtime/205e5a11-68db-4f06-977a-6d2859b7c9df/` |

supervisor 全程保持 Pi RPC 管道。两次 SIGKILL 只作用于自己创建的 coordinator 子进程。每次恢复先用已退出 ChildProcess＋锁 nonce 调用 r1.1 `recoverOwned`，随后 clean close，再让新 coordinator 接管；其间没有未决宿主调用。这个明确的交接窗口不代表任意孤儿恢复或恢复过程中再次崩溃的高可用保证。

每次 coordinator 重启后及最终均向仍运行的 Pi 查询 PID、instance、session，三者不变。禁用工具、其他扩展、MCP 和项目上下文，沿用现有模型配置；本实验不包含真实 HTML 修改或任意工具副作用恢复。

### 实验结果

| 子项 | 实际执行与断言 | 结论 |
| --- | --- | --- |
| accepted 后 coordinator 崩溃 | 消息 `r2-6e2502dd-37ac-49a1-a766-9e1a1d3a53de` 仅本地持久化，0 次 host admit；杀死 coordinator 后恢复，首次送入同一 Pi，1 次 admit、1 个真实输入 entry | PASS |
| 宿主接纳、桥接接纳回执丢失 | 消息 `r2-010c1269-402e-4e54-aa53-5b4335e4b26a` 在 Pi 的暂停队列持久接纳；supervisor 注入丢回执，桥接变 unknown，再重启 coordinator；以原 binding／epoch／id／digest／attempt 查询宿主并恢复 queued；释放队列后消费和回复；始终只有 1 次 admit | PASS，限该明确窗口 |
| 不存在的宿主记录 | 查询全新不存在 ID，返回 unknown、safeToResend:false；没有据此重投 | PASS |
| 代次／消费模式 | 旧 coordinator claim token 的 record 被 STALE 拒绝；bridge 模式拒绝 poll claim；未决 host_queued 阻止切换模式 | PASS，本地裁决接真实桥接；不是原生 poll 集成 |
| final batch＋marker | 保存已有排队输入 `r2-cf8c81c4-3fb1-4612-94fc-3a7985edaa2c`、最终输入 `r2-991aebd6-fa29-42b3-a724-977e13e40686`、结束 marker `r2-69312b4b-5852-44db-9b9f-89297e782a7b-marker`；暂停宿主时保持 ending；晚到新输入拒绝；按序进入 Pi context_with_system 后 ended | PASS |
| 不等待模型回复才结束 | ended 快照中 marker 状态为 delivered，尚无该 marker 的 reply；约 **3019 ms** 后才收到其回复证据，Pi 继续运行 | PASS；该时间仅证实先后关系，不是性能基准 |

共 **5 个全新输入 ID、5 次宿主 admit、5 个唯一真实输入 entry**。这一组计数证明指定实验没有重复输入，不外推为通用 exactly-once。队列停顿是明确故障注入控制，不是正常产品的轮询实现。

原始证据：[combined-events.jsonl](../verification/polish-pi-combined-m0/evidence/combined-events.jsonl)、[combined-result.json](../verification/polish-pi-combined-m0/evidence/combined-result.json)。结果文件保存重启前后快照、未知到 queued 的查询、固定结束集合、input IDs、最终 identity、admit 次数和进程退出。

## 3. 原生 legacy poll：实际代码路径已查，集成未运行

`src/cli.js` 的 `pollCommand` 调用 `ensureServer`，随后 HTTP `/api/poll`。`src/server.js` 的 `handlePoll` 是 `serve` 内部闭包，通过 `activePolls` 和 `pollOwnershipLock` 获取持有权，再破坏性调用 `store.takeFeedback`。服务返回可用控制对象之前会实际 listen；没有导出的非监听 poll handler。

当前隔离 Authority 不会自动与生产 SessionStore 共享锁。因本轮不准新增监听、也不改生产源码，**真实 poll＋桥接竞争为 NOT RUN**。没有调用 CLI poll／ensureServer，没有 monkey-patch 网络库，也没有把 IPC 消费者替身称作真实 poll。

待接入边界：在原生 takeFeedback 前获得共享消费者代次／claim，bridge 使用同一权威；poll 写出 JSON 只算投递动作，不能自动当 Pi 消费证明；断开恢复沿用同一消息／attempt，模式切换必须拒绝未决投递，旧 token 不能改写状态。仅在这些接入完成后，才能运行实际 poll 和桥接争抢同批真实 Pi 输入的验收。现有 preview 不包含这一适配，不能单靠开网页补齐 G05。

## 4. 网页准备与本地测试

准备了静态页、纯 Request handler 及显式导出的预览启动函数，**未调用启动函数、未监听、未跑浏览器**。

- `/binding`、`/submit`、`/query`、`/snapshot`、同端口 SSE `/events`、`/end` 已有候选实现。
- 整体提交使用 scope=session，无 DOM 锚点。页面刷新从快照恢复记录；回复正文按精确消息 ID 查询宿主，使用 textContent 显示。
- SSE 先订阅再取快照，重连发送最新完整快照，客户端拒绝旧 version；reply／ended 事实可恢复。没有宣称每条瞬态通知的历史重放保证。
- end 固定最终集合；页面离线时 supervisor 内排空继续。当前页是协议验证工具，不是正式浮窗／圆球 UI，也没有替代正式原生表单回归。

[final-tests.txt](../verification/polish-pi-combined-m0/evidence/final-tests.txt)：**30/30 通过**，其中 r2 新增 7 项（宿主身份／查询 3、子进程恢复 1、纯网页接口 3），复用 r1.1 的 23 项。r2 子进程单测的宿主是显式替身；纯网页测试为内存 Request／ReadableStream，不能当作真实浏览器 SSE 或网络重连证据。另有 12 个 JavaScript 文件通过语法检查。RED 日志和最终日志全部保存。

真实 Pi 实跑源码版本见 [real-run-source-version.json](../verification/polish-pi-combined-m0/evidence/real-run-source-version.json)，核心实跑代码之后没有修改。网页代码在实跑后准备，不能由 Pi 实跑宣称它已验收。最终完整源码与文档哈希见 [code-version.json](../verification/polish-pi-combined-m0/evidence/code-version.json)。

## 5. G01–G07 当前结论

| 门槛 | 本轮证据 | 尚缺 |
| --- | --- | --- |
| G01 当前实例网页链路 | 非监听同一 live Pi 绑定核验通过 | 新机制真实网页链路 NOT RUN；不冒称用户原工作会话验收 |
| G02 自动处理 | accepted 恢复到同一 Pi、释放队列后自动处理通过 | 真实网页提交后的新链路验收 |
| G03 回执身份 | admission、消费、reply 分离；丢接纳回执后精确查询通过 | 浏览器状态显示与真实链路组合 |
| G04 投递未知 | 指定的 host admitted／lost receipt 窗口恢复成功；不存在记录保持 unknown | 无权威可查事实的其他调用窗口仍未知；本轮不外推，r1.1 reply-gap 按勘误单独归类 |
| G05 唯一消费与恢复 | coordinator 两次退出、同一 Pi、旧代次拒绝通过 | **原生 legacy poll 集成 NOT RUN** |
| G06 结束与同步 | 真实 Pi final＋marker 消费排空通过；纯快照／SSE 接口通过 | 浏览器刷新、实际网络重连、关闭页后排空 NOT RUN |
| G07 性能 | 只准备时间点采集及样本计划 | 新网页 30 次分阶段样本、直接 Pi 对照均 NOT RUN |

## 6. 下一步边界与清理

下一轮候选监听仅 `127.0.0.1:49793`，最多 10 分钟，Pi 启动并记录身份后才 bind。准备代码遇 bind 失败退出自有进程，不找其他端口、不处理占用者；超时关闭 SSE／HTTP 与自有进程。精确接口、清理顺序、浏览器用例、30 次分阶段时延和同模型直接 Pi 对照计划见 [BROWSER-PLAN.md](../verification/polish-pi-combined-m0/BROWSER-PLAN.md)。**这不是已有监听许可；须另获授权才运行。**

本轮 Pi 69225 已退出，coordinator 69248／69291 为故障注入 SIGKILL，69942 正常退出。49793 无监听；49791／49792 仍为 33191／95933。旧证据完整性、退出核对和端口输出见 [final-checks.json](../verification/polish-pi-combined-m0/evidence/final-checks.json)。未运行生产全套 check，因为本轮只有隔离验证文件且没有推送；没有用本地通过冒充生产回归。

本轮止于 Pi M0，交付局部组合证据和可审查的网页准备，等待独立评审。
