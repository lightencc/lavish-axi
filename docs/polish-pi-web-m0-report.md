# Polish Pi 网页 M0 实测报告

日期：2026-10-30（Asia/Shanghai）。依据：[开发书 v1.2](polish-development-spec.md) 及本轮对 `127.0.0.1:49793` 最长 10 分钟的明确许可。

**结论：专用 Pi 实例的网页投递、自动处理和回执关联已取得真实浏览器证据；完整 Pi M0 仍未通过，不进入 M1–M3。** 崩溃后安全恢复、跨路径唯一消费、结束排空和重连协议仍有缺口。Codex 继续后置，未宣称双宿主完成。

## 1. 实验边界和身份

本轮直接运行上一轮准备的验证代码，没有修改生产源码或前轮验证文件。服务只监听 `127.0.0.1:49793`；原型 `49791/49792` 未改绑、未重启。专用 Pi 先启动并报告身份，再创建桥接，最后开放网页。所有消息进入同一个进程／实例／session，没有按请求创建会话。

| 项目 | 实测值 |
| --- | --- |
| 服务 PID | 28007，`node verification/polish-pi-m0/serve.js` |
| 专用 Pi PID | 28022，父进程 28007 |
| 实例 ID | `c8538c79-f205-4c9c-9187-41e8caee3857` |
| session ID | `01a18cb5-ad4e-745f-8bb4-7a5acda50d47` |
| 会话名称 | `POLISH-PI-M0-e0d0a758-4c78-437e-90ae-2c0016a487c9` |
| Pi／Node | 1.4.0／v26.7.0 |
| 模型 | 原配置 `magpie / grok/grok-4.7`，thinking medium |
| 浏览器 | Chrome DevTools 管理的隔离上下文 `polish-pi-m0-web-20261030`；实际 UA 保存在浏览器证据 |
| 运行限制 | 禁用模型工具、MCP、其他扩展和项目上下文；只显式加载本轮验证扩展 |

时间线（下列为 UTC，原始日志统一如此）：12:07:58.895 启动 Pi，12:07:59.168 ready，12:07:59.169 核对实例并绑定，12:07:59.190 开始监听。12:14:43.004 Pi 在受控崩溃后退出，服务关闭路径随之执行；12:15:11.592 已核实端口释放、两个自有进程均退出。监听到宿主退出间隔为 403.814 秒；从监听到确认释放的上界约 432.4 秒，均未超过 600 秒。

证据：[identity.json](../verification/polish-pi-web-m0/evidence/identity.json)、[versions.json](../verification/polish-pi-web-m0/evidence/versions.json)、[cleanup-and-recovery.json](../verification/polish-pi-web-m0/evidence/cleanup-and-recovery.json)。后者同时确认原型仍由原 PID 33191／95933 监听。

## 2. 真实网页链路

第一条通过浏览器的 fill／click 工具填写并点击发送，实际网络请求为网页 `/submit`，随后点击查询显示 Pi 回复 `WEB_ACK_1208`。其 ID 为 `pi3-fb8b94cc-348b-44e2-9b08-0607e9adb39a`。页面绑定、HTTP 载荷、宿主 details、输入条目和回复条目可逐一核对。

后续 30 次由浏览器内测试脚本驱动同一页面的表单 `requestSubmit()` 和真实查询按钮，执行原页面事件处理器、实际 HTTP 请求、同一宿主推理和真实回复渲染。没有 HTTP mock、假回复或直接 RPC 替代网页。故障注入和重复／非法载荷检查另用同一浏览器向本机接口发请求，报告中与表单交互样本分开。

全轮共 **38 条不同消息**：首条正常验证 1 条、性能样本 30 条、忙碌验证 2 条、取消发送请求 1 条、首次未成功注入的故障窗口 2 条、最终实际崩溃窗口 2 条。36 条取得持久回复；最终 2 条未完成并保留，不因是故障测试而剔除。37 条各发生一次派发和输入事件，最后一条仅接纳未派发；没有重复执行证据。

证据：[首次网络请求](../verification/polish-pi-web-m0/evidence/first-submit-network.json)、[首次回复截图](../verification/polish-pi-web-m0/evidence/first-web-reply.png)、[浏览器样本](../verification/polish-pi-web-m0/evidence/browser-samples.json)、[网络记录](../verification/polish-pi-web-m0/evidence/network-before-reload.json)、[宿主原始事件](../verification/polish-pi-web-m0/evidence/host-events.jsonl)、[汇总断言](../verification/polish-pi-web-m0/evidence/assertions.json)。

## 3. 持久接纳、处理输入与回复分开核验

- **本地接纳：** 桥接 inbox 保存消息、固定绑定、摘要和 admittedAt，再记录 dispatching。[bridge-state.json](../verification/polish-pi-web-m0/evidence/bridge-state.json) 保留全部 38 条本地记录。
- **宿主接纳：** Pi 扩展的持久 inbox 写入完成后返回业务回执，含消息 ID、摘要、实例和 session。它是扩展拥有的持久队列，不冒充 Pi 原生 followUp 持久性，也不把 RPC handled 当成功。
- **处理输入：** Pi 的 `context_with_system` 包含对应结构化 custom message 后才记录输入证据。忙碌测试中，浏览器查询到该事实后显示橙色 `rgb(212, 107, 8)`。接纳时仍是等待状态。该事件不等于模型首 token、执行成功或工具副作用完成。
- **持久回复：** 使用 `turn_end.messageEntryId` 关联已经写入 Pi 历史的 assistant 条目，再以结构化输入身份和确切回复条目核验。内容只作一致性校验，不用于猜测 reply_to。

本轮证明的是受控、无其他扩展和无工具调用环境下的上述链路，不自动推广到任意插件、工具多轮、分支切换或压缩。验证页仍通过查询更新状态；没有实时推送，不能把测试脚本的 100 ms 查询节拍当作产品能力。

## 4. 正常、忙碌及未知结果

**忙碌排队：** 第一条进入输入的时间为 12:11:13.814，第二条持久接纳为 12:11:13.970；第一条回复落盘为 12:11:17.952，第二条才在 12:11:18.038 派发。前一任务没有 abort 或 steer，后续收到 `BUSY_QUEUE_ACK`。[browser-busy.json](../verification/polish-pi-web-m0/evidence/browser-busy.json) 和汇总断言保留了原始状态及排序。

**浏览器丢接纳响应：** 对新消息 `pi3-c9727972-8820-47ee-b17c-ee5b4d5676ae` 发起 `/submit`，5 ms 后用 AbortController 取消浏览器请求，实际得到 AbortError。只查询原 ID，随后核实同一宿主的持久回复 `ABORT_ACK`，重投次数为零。这个实验覆盖发送方没有拿到响应、宿主仍存活的窗口；不是宿主崩溃恢复证明。[browser-abort.json](../verification/polish-pi-web-m0/evidence/browser-abort.json)

**重复与越权输入：** 对本轮已完成消息重复同 ID／同载荷，返回既有查询结果，没有新增派发；同 ID 改载荷返回 409，带任意 session／selector 的载荷返回 400。没有向无关会话注入。[browser-duplicate-security.json](../verification/polish-pi-web-m0/evidence/browser-duplicate-security.json)

## 5. 刷新与实际崩溃结果

**刷新缺陷已复现。** 刷新前页面有 33 条评论，刷新后列表为 0；绑定仍是原实例，按已知 ID 查询服务端记录仍能得到回复。数据没有从服务端消失，但网页缺乏历史恢复和同步入口。后台回复不会自动更新页面。页面也没有 ending／ended 控件或排空协议，所以没有用关服务来冒充结束通信验收。

证据：[刷新前](../verification/polish-pi-web-m0/evidence/before-reload.json)、[刷新后](../verification/polish-pi-web-m0/evidence/after-reload.json)。

**崩溃注入仅针对自有 Pi。** 最初的进程身份保护要求完整 argv，但 Pi 将进程标题改为 `pi`，保护检查拒绝发送信号；该次两条消息随后均正常完成，证据未删除。最终另用全新标记消息，核对 PID、PPID、自有父进程命令及实际 inbox 状态后，才对 PID 28022 发送 SIGKILL。不存在按端口杀进程，也未终止其他实例。

实际崩溃保留：

| 消息 | 崩溃前及持久证据 | 后续处理 |
| --- | --- | --- |
| `pi3-d9590feb-5785-42ec-8bf1-72b21a622158` | 已进入 processing，Pi 历史中有确切输入；未有已关联回复 | 执行完成结果未知；不重投、不宣称失败或完成 |
| `pi3-0c5cabc9-e051-44b9-a121-622e596cdc7b` | 宿主 inbox 仍为 accepted；没有 dispatch／输入条目 | 接纳记录成功保留，但未证明自动恢复消费；本轮不重投 |

只读核查发现宿主写锁仍保留。没有启动恢复 Pi、偷取旧锁、重放历史或重新开服务。崩溃导致服务一并关闭，浏览器查询失败且仍保留旧接纳提示，说明连接失效状态也尚未完善。证据：[crash-browser.json](../verification/polish-pi-web-m0/evidence/crash-browser.json)、[crash-injection.json](../verification/polish-pi-web-m0/evidence/crash-injection.json)、[清理及持久记录](../verification/polish-pi-web-m0/evidence/cleanup-and-recovery.json)、[浏览器故障后状态](../verification/polish-pi-web-m0/evidence/browser-after-crash.json)。

宿主 inbox 的 queued 事实此次跨进程崩溃保留，是相对首轮原生 RPC 队列的局部改善。但公开宿主调用和侧账本不是原子事务，输入事件也不是模型完成事实；缺少安全接管、回复关联窗口恢复及跨 poll 的唯一消费协议。不能据此宣称 exactly-once 或完整恢复通过。

## 6. 30 次网页样本与性能边界

同一 Pi、同模型、连续简单往返，30/30 收到精确匹配回复。浏览器用 performance.now 测量；接纳 UI 以 20 ms 节拍采样，查询及回复以 100 ms 节拍采样。nearest-rank P50／P95，所有样本保留。

| 实测指标 | n | P50 | P95 | 最大 |
| --- | --- | --- | --- | --- |
| 提交后发送中 DOM 已更新 | 30 | 1.8 ms | 2.7 ms | 4.9 ms |
| 点击至页面显示宿主持久接纳 | 30 | 45.5 ms | 67.7 ms | 67.8 ms |
| 点击至查询显示处理输入 | 30 | 247.9 ms | 272.3 ms | 273.3 ms |
| 点击至查询显示匹配回复 | 30 | 1,394.0 ms | 2,396.8 ms | 3,214.7 ms |
| Resource Timing 的点击至提交响应结束 | 17 | 42.9 ms | 53.8 ms | 53.8 ms |

“发送中 DOM 已更新”不是独立绘制帧测量；接纳指标合并了本地与宿主持久化，不能据此拆出各阶段成本。后续 Resource Timing 条目因浏览器默认缓冲上限没有保留，所以最后一行只有 17 条，不能冒充 30 条；前四行独立记录完整。初次统计脚本假设每条都有 resource 数据而报错，之后按实际 n 统计，没有删除样本或补造数值。

缺少模型开始、首 token、回复落盘至实时通知的独立测量，也没有同模型相近上下文的直接聊天对照。30 条正常样本无失败不等于整轮零失败：整轮仍有最终 2 条中断／未完成消息、一次取消响应及预期 409／400。这些限制使完整 G07 尚不能通过。[browser-latency.json](../verification/polish-pi-web-m0/evidence/browser-latency.json)

## 7. G01–G07 更新

| 门槛 | 本轮状态 | 依据与边界 |
| --- | --- | --- |
| G01 网页到既有活动 session | **PASS（获准的专用 Pi 实例）** | Pi ready／get_state 核对后才绑定网页；实际 DOM → HTTP → 固定实例 → 结构化输入 → 持久回复；全部同一 PID／session。不是通用 TUI 附着能力证明 |
| G02 自动处理 | **PASS（正常网页路径）** | 空闲、连续回合、实际忙碌时新接纳均自动执行，不打断原任务；崩溃恢复另由 G05 判定 |
| G03 接纳与真实消费分离 | **PASS（本轮受控链路）** | 本地记录、宿主扩展持久接纳、模型请求上下文和回复条目身份可核验；等待与橙色处理状态分开。实时推送及模型首 token 未验证 |
| G04 未知结果与幂等 | **FAIL（完整恢复门槛）** | 浏览器丢响应可查询恢复、重复不二次派发；实际崩溃后在途结果仍未知，无可证明安全的重投／完成查证机制 |
| G05 恢复与唯一消费 | **FAIL（完整门槛）** | queued 记录保留，但旧锁／代次接管和同会话恢复未实现；桥接与遗留 poll 并发验证 NOT RUN，不能由本轮单入口推导唯一消费 |
| G06 结束排空与无漏重连 | **FAIL；结束排空子项 NOT RUN** | 真实刷新丢网页列表、断连未恢复；没有实时快照／事件协议。ending／ended 尚未实现，不用服务退出代替 |
| G07 完整性能验收 | **NOT RUN（完整指标集）；30 次网页采样已完成** | 已有 UI／组合回执／查询回复数据；缺分段模型指标、实时通知和直接聊天对照，不能宣称全面达到 P0 |

G01–G03 的 PASS 只限上述批准的专用、无工具测试链路，不代表完整产品验收；G04–G07 仍阻止 M1–M3。Codex 本阶段 **后置／NOT RUN**，不作为 Pi 阶段阻塞项，也未标为支持。

## 8. 交付与停止点

本轮证据在 `verification/polish-pi-web-m0/evidence/`，旧报告、开发书 v1.2 及原验证代码均保持原哈希，清单见 [manifest.json](../verification/polish-pi-web-m0/evidence/manifest.json)。未新增依赖、权限、远控配置或持久凭据；未外传、提交、推送或部署。

浏览器控制台出现验证页 favicon 404，故障检查另产生预期的 409／400／取消／连接失败；未把控制台宣称为完全无错。DevTools 两次指定路径截图写入被工具路径限制拒绝，随后使用工具正常返回的内联原始截图归档，没有修改权限。上述执行限制不改变网络／宿主证据。

后续要继续，优先解决宿主侧可查询事务／幂等与安全接管，再处理网页完整状态同步和结束协议；单纯增加重试会引入重复执行风险。临时许可已使用并结束，本轮不重新监听、不处理历史未知消息。停在 **Pi M0**，由父任务独立审证后决定下一步，M1–M3 仍未放行。
