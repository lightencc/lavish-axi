# Pi M0 开窗前修复与真实 poll 接入报告 r3

日期：2026-10-30。产品契约维持 **v1.2**，Pi 优先。本轮完成父任务安排的开窗前最小接入，**不放行完整 M0，不进入 M1–M3**。没有启动 TCP 监听，没有重启或修改 49791／49792 原型服务，没有修改安装版 Pi、凭据或安全配置，没有上传、提交、推送或部署。

当前修复版在 `verification/polish-pi-prewindow-m0/`。r2 的 `page.js`、报告和证据作为历史原件保持不变；此前 **169 条 manifest 条目全部前后哈希一致**。准备启动器提供的是 r3 页面，不再使用 r2 的旧客户端。

## 1. 客户端缺陷：已复现并修复

r2 的 `apply` 对 `next.version <= state.version` 直接返回。如果 replied 状态已经看到、首次 `/query` 却失败，同版本的手动刷新或 SSE 重连无法补回复正文。

r3 将状态版本接纳与回复缓存补齐分开：只拒绝旧版本；同版本使用当前权威状态继续查询缺失回复。缓存已有或查询仍进行中不重复查询；修复只读 `/query`，不调用 `/submit` 或 `/end`。

[client.test.js](../verification/polish-pi-prewindow-m0/client.test.js) 在 VM 中执行实际 page.js，DOM／fetch／EventSource 是明确的边界替身。RED 阶段 3 项中 2 项准确失败，均为 query 次数实际 1、预期 2；旧事件不回退用例原本通过。修复后三项均通过，覆盖同版本手动补取、断线后同版本补取、replied／ended 不被旧事件回退。不是用服务端 handler 测试冒充客户端通过。

证据：[client-red.txt](../verification/polish-pi-prewindow-m0/evidence/client-red.txt)、[client-green.txt](../verification/polish-pi-prewindow-m0/evidence/client-green.txt)。**实际浏览器仍 NOT RUN。**

## 2. 生产代码实际改动范围

| 文件 | 必要改动 | 兼容边界 |
| --- | --- | --- |
| `src/server.js` | 把原 handlePoll 提取为导出的 createPollHandler，生产 GET／POST `/api/poll` 仍使用它；立即 take 和长轮询事件 take 都传相同模式／代次 lease；bound 断开使用原 claim 标 unknown | 大部分 diff 是原处理器搬移；原 activePolls、pollOwnershipLock、takeover、heartbeat、断开清理保持。未绑定会话继续原 restore／Seen 行为 |
| `src/session-store.js` | 显式内部 bind；同一 state.json、同一 store.lock 下的 claim／模式／generation／host reservation／回执／恢复／固定结束集合；保留 ledger 字段；bound 写入采用 fsync→rename→目录 fsync | 无公共启用 flag，默认不启用；只允许新空 artifact 会话绑定，不迁移旧消息。写失败后该 store 实例停止继续服务 |
| 新增 `src/feedback-delivery.js` | 单条派发、唯一未决投递、精确身份、模式与代次检查、消费事实与 reply 分离、固定 final＋marker | 不实现任意工具副作用恢复、跨进程锁或完整 exactly-once |
| `src/cli.js` | poll 输出保留可选 delivery 身份及其类型，next_step 仍在 DOM snapshot 前 | 未绑定响应没有该字段，原输出不变 |
| 新增 3 个 test 文件 | 真实 store、真实 poll handler 和 CLI 输出的非监听回归 | HTTP req/res 替身明确标注；没有执行真实网络 CLI 启动链路 |
| README、docs/invariants.md | 记录 opt-in 边界、真实消费门槛及技术不变量 | 没有声称已提供正式 polish CLI 或完成 UI 迁移 |

当前绑定会话中，poll 和桥接都必须通过 `SessionStore.takeFeedback`。模式不符、旧 generation、已存在未决 claim 均不能再取。claim 和移出 pending 在同一个原子状态写中发生；调用宿主前还要持久化 host reservation，重复 poll 响应不能再次调用宿主。

poll 写出 JSON、HTTP 200、host admission 都不是 consumed。只有受信进程内适配器能提交核对过 binding／epoch／id／digest／attempt 的输入证据。浏览器没有 claim、mode、recover 或 reconcile 接口。

绑定会话的 legacy 无关联 reply/end 和 reopen 明确拒绝，避免旧接口提前完成／结束；本轮 `/end` 使用固定批次契约。普通 Lavish 会话未启用 ledger，继续原接口行为。完整原生页面表单、正式 chrome、所有 CLI 生命周期迁移仍不属于本轮放行范围。

`recoverFeedback` 是单一服务器所有权已建立后的内部交接操作，不根据 PID 不在或租约超时夺权。本轮 r3 的重建存储／账本恢复用受控单写者测试；没有把它声称为 r2 那套独立 coordinator 子进程接管协议的原样复验，也没有新增高可用承诺。

## 3. 真实路径与真实 Pi 证据

最终组件实验执行的是：**生产 createPollHandler → 生产 SessionStore.takeFeedback → 同一账本的 host reservation → 专用 Pi 公开扩展输入**。只有 HTTP req/res 边界在内存中；没有 IPC 假 poll、没有 TCP、没有模型文本匹配决定归属。

最终实跑身份：

| 项 | 值 |
| --- | --- |
| Pi PID | **24809** |
| instance | `c014753e-7f75-47de-887d-7cf3edf66950` |
| session | `01a18d11-916f-718e-9382-440789055ad1` |
| artifact | `verification/polish-pi-prewindow-m0/runtime/e9a40399-7f96-433d-a3f9-0e34f0239dd1/fixture.html` |

这个 run 始终同一个 Pi；结尾再次查询身份，PID／instance／session 不变。

| 子项 | 实际结果 |
| --- | --- |
| bridge 模式下真实 poll handler 竞争 | MODE 拒绝；切为 poll 后才领取消息 `r3-85347665-5e47-489d-8482-aa90af98fa82` |
| 原生 poll 响应后状态 | afterHttpWrite 仍 consumed=false；旧 bridge lease 被 STALE 拒绝；由 runtime.deliver 送 Pi 后才有输入证据 |
| 重复 poll 响应 | 重复 deliver 被拒绝；该消息宿主 admit 计数为 1，真实输入 entry 计数为 1 |
| 宿主接纳回执丢失 | `r3-83289f31-7254-4451-82c0-f2aa1f30c311` 留 unknown；代次恢复后旧 token 拒绝；按原身份正向查询恢复 queued，释放宿主队列后消费；0 重投 |
| fixed final＋marker | `r3-f2fd1250-762c-4868-bcb2-61b3b7a3fd9e` 和 `r3-bc62d487-4e43-44f8-a357-24f616ac9725-marker` 排空；marker 消费前仍 ending，消费后 ended 时 marker 只有 delivered、尚未 replied |

最终 run **4 个全新输入、4 次 admit、4 个唯一真实输入 entry**。没有重投历史未知。前期同类组件 run（Pi PID 52287）也有独立的 4 个新输入并通过，原始证据保留；不能把两个 run 说成同一个 Pi 会话。

最终原始证据：[pi-poll-final-events.jsonl](../verification/polish-pi-prewindow-m0/evidence/pi-poll-final-events.jsonl)、[pi-poll-final-result.json](../verification/polish-pi-prewindow-m0/evidence/pi-poll-final-result.json)。前期 run 为同目录的 pi-poll-events／result。最终 run 在禁止监听 tripwire 下执行，Pi 的模型请求为既有配置的出站请求，不是本地监听。

`delivery_unknown` 与已消费但 reply unknown 仍分开；仅回复关联未知不阻止结束。另补单测证明，迟到的传输错误不能把已经验证的 reply 降级成 executionUnknown。

## 4. 启动、取消、兼容性验证

[final-tests.txt](../verification/polish-pi-prewindow-m0/evidence/final-tests.txt) 共 **108/108 通过**：

- 原 SessionStore 回归 77 项：队列、结构化定位、附件、恢复、结束及历史回执等原有行为。
- 共享账本 5 项：排他、旧代次、宿主 reservation、持久恢复、unknown 正向核实、fixed end、verified reply 不降级。
- 真实 poll handler 5 项：立即取、事件触发取、等待时模式变更 fencing、断开后保留 unknown、未绑定 GET／POST takeover 兼容。
- CLI 输出 1 项：保留 delivery，保持 next_step 与 DOM 的顺序。
- 实际客户端逻辑 3 项、纯网页接口／SSE 4 项。
- 窗口生命周期／实际 bind 适配函数 12 项：固定地址／端口、EADDRINUSE、600000 ms 截止、ready／bind 中途退出、幂等清理、流式 socket 关闭、真实自有 Node 子进程退出。
- Pi spawn 失败 1 项：实际 ENOENT 不发 exit，close 仍使退出 Promise 结算，清理不会一直等待。

窗口测试中的 Server／timer 为明确替身，EADDRINUSE 是注入事件；没有以真的占用端口做实验，也没有替换端口规避限制。SSE 测试是内存 ReadableStream：包括初始 snapshot pending 时取消，取消后不重新挂订阅／heartbeat；不能代替浏览器网络断连实验。

最终测试命令加载 `no-listen-guard.js`，真实 net.Server.listen 会立即报错。另完成全项目 typecheck、相关源码／测试 lint 和 format、构建与 r3 JavaScript 语法检查。没有运行完整 `pnpm run check`：其中原有网络测试会启动监听，本轮禁止该动作。没有将这项限制写成全套检查通过。

开发失败证据也保留：最初依赖缺失和自动 bootstrap 的 prepare 失败；补齐锁文件依赖后 build 通过；poll HTTP 替身缺少 req.get 的失败；CLI 返回类型遗漏 delivery 的类型错误；首次 probe 模块相对路径错误。最终 Pi 复验第一次因相对 NODE_OPTIONS guard 随子进程 cwd 变化而在 ready 前退出，未接纳任何消息；失败 PID 22405 已退出，证据为 pi-poll-final-bootstrap-error-*。改用绝对 guard 路径后的独立新 run 才是上述最终通过结果。

## 5. 版本、哈希与未测边界

- 产品 v1.2／本轮代码 r3：[CONTRACT.md](../verification/polish-pi-prewindow-m0/CONTRACT.md)。
- 最终 Pi 实跑源码：[final-real-run-source-version.json](../verification/polish-pi-prewindow-m0/evidence/final-real-run-source-version.json)。生产核心、runtime、host、peer 与实跑哈希一致；实跑后只对未启动的 serve-prepared 增加显式 GET／POST guard，防止 Express 的隐式 HEAD 路由进入 poll。该启动器已语法检查，真实 HTTP 仍未测。
- 最终交付文件哈希：[code-version.json](../verification/polish-pi-prewindow-m0/evidence/code-version.json)；完整证据清单：[manifest.json](../verification/polish-pi-prewindow-m0/evidence/manifest.json)。
- 可审查的本地生产补丁：[production.patch](../verification/polish-pi-prewindow-m0/evidence/production.patch)，包括新生产模块和新增测试；没有创建 commit 或 PR。

仍为 NOT RUN 的是实际 TCP／Express 网络链路、完整 CLI ensureServer 启动链路、真实浏览器刷新／重连／SSE、浏览器关闭后真实排空、30 次分阶段性能与直接 Pi 对照。前期 r2 的旧截图、轮询时延不算这些新项的证据。

## 6. 可交父任务申请的新窗口

[BROWSER-PLAN.md](../verification/polish-pi-prewindow-m0/BROWSER-PLAN.md) 已列出精确方法／路由、单 artifact 与 state.json 范围、真实 poll 与页面如何共用服务，以及时限、拒绝占用、退出和核验顺序。

候选仅 **127.0.0.1:49793，最多 10 分钟**；专用 Pi ready 并记录身份后才 bind。一个服务同时承载 `/api/poll`（GET／POST takeover）、`/binding`、`/submit`、`/query`、`/snapshot`、同端口 `/events`、`/end`、`/` 和 `/page.js`。不增加 `/health` 或通用会话管理面，不启动完整 CLI ensureServer 来另起服务；网络原生 poll 用直接 HTTP 请求验证真实 handler。

**本条仅为准备结果，未启动、未申请自动延时，也不代表已有监听许可；由父任务另取许可后执行。** 原型 PID 33191／95933 未变，49793 无监听。两次成功 Pi 与一次 ready 前失败的 Pi 均已退出；前后证据和端口输出见 [final-checks.json](../verification/polish-pi-prewindow-m0/evidence/final-checks.json)。

本轮止于可审核的 M0 开窗前组合，交父任务独立评审。
