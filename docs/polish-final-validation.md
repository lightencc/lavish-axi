# Polish Pi 正式版验收记录

日期：2026-10-31（Asia/Shanghai）。本记录承接[开发书](polish-development-spec.md)与[前一轮产品验证](polish-product-validation.md)，不覆盖历史证据。Pi 范围的 G01–G07 与 A01–A27 已按下述证据层次完成；真实功能、故障恢复和最终构建性能均有记录。Codex 后置，不包含在本次结论内。

## 最终构建与自动检查

代码保留在本地工作区，未提交、推送或发布。构建包含真实 `polish` 命令及当前 Pi session 扩展，不启动替代模型会话。

- `dist/pi-extension.mjs` SHA-256：`b640508077c88bbfcad74e206dcb1798e126385da904251ad641dc9672baf247`。
- 全部交付资产哈希：[final-closed-build-hashes.json](../verification/polish-final-product/final-closed-build-hashes.json)。
- `pnpm run check`：1749 项测试中 **1741 通过、0 失败、8 条既有条件测试跳过**；构建、lint、格式、类型、skill/plugin 新鲜度检查全部通过。[完整输出](../verification/polish-final-product/evidence/full-check-final.log)。
- DNS 测试仅在子进程中为指定 `.invalid` 名称提供 ENOTFOUND；没有修改用户 DNS、网络或安全配置，也没有跳过或放松原断言。

四项 opt-in 上游浏览器回归亦已实测：键盘批注、附件完整上传回传、六旧标签页加第七 session 的事件连接、移动端 conversation sheet 几何断言。首轮为 3 通过／1 失败，移动端因工具在 `emulate` 前没有 selected page 而未进入产品断言；仅补上测试自有空白页初始化，保留全部断言后单独重跑为 1 通过／0 失败／0 跳过。原失败未覆盖：[首轮日志](../verification/polish-final-product/evidence/upstream-browser-check.log)、[移动端复跑](../verification/polish-final-product/evidence/upstream-mobile-browser-recheck.log)。测试文件 ESLint／Prettier 检查通过，测试进程已清理。

## 本轮修复

1. 整体意见和普通整页表单为 `scope=session`，客户端、SDK 和服务端均不附加元素引用、定位、描边或圆球。定位评论保留其独立语义。
2. 原生文字选择支持精确跨段、移出 iframe 后释放及键盘入口。收起评论清理浏览器旧文字选区，避免下一次拖选进入原生文本拖放。
3. 原元素删除或内容已变化时不误挂到同 selector 的相似段落；显示“原内容位置已变化”，讨论仍可从整体入口访问。
4. 新同步连接先取得权威快照，完整状态按可见版本链衔接；旧连接、旧快照、重复事件和关闭握手期间的迟到帧不能回滚当前状态。缺口或 epoch 变化触发重新同步。
5. 一条宿主查询失败不阻断其他 artifact 恢复；观测日志失败不改变投递或结束行为。
6. 同一 Pi session 重启复用原监听端口；不接管或终止占用该端口的其他进程。已消费但未完成的执行恢复为“结果待核实”，不永久显示橙色，也不自动重放。
7. 显式 reopen 的权威新快照同时恢复原生表单与页面控件；旧未决请求身份不自动迁移或发送。
8. Pi 自动重试后的精确成功回执优先于过时失败元数据；新 context、消费与回复清除旧错误。历史原消息恢复不增加 Pi 输入次数。
9. 绑定前核对并同步真实 Pi session 文件；尚无实际对话的空会话返回 409，不接收无法恢复身份的意见。
10. 普通提交输掉结束封存竞态时返回明确的 409 CLOSED；结束固定集合、相同请求重试和不同载荷冲突保持原契约。

## 真实原生 UI

使用正式 `/session` 页面、SDK 与 chrome，独立测试宿主提供可控状态；这一部分是浏览器交互证据，**不是 Pi 模型收发证据**。

已通过：精确跨段拖选、发送后继续原生拖选、iframe 外释放、键盘整体入口、原生输入与按钮、同 selector 内容替换不误挂、丢失位置的历史入口、无数字圆球、360×640 窄屏浮窗及发送按钮可见。

原始结果与实际测试源码哈希：[verified-summary.json](../verification/polish-final-ui/verified-summary.json)、[verified-source-sha256.txt](../verification/polish-final-ui/verified-source-sha256.txt)。浏览器使用真实鼠标和键盘输入；没有将合成 Range 当作原生选择证据。

## 真实 Pi 网页功能闭环

同一个 Pi session `01a18e12-942e-7785-aa90-41587c940bbb` 中完成：三处定位评论真实消费后变橙、回复后变蓝，圆球无数字；逐条刷新并勾选完成后最终为零个球。两轮分别由定位意见修改标题、整体意见修改正文，均核对磁盘 HTML、精确回复，再点击刷新、完成。标题改写后原锚点失效，按“原内容位置已变化”从历史中完成；该处球消失不能单独算作勾选完成证据。原生单选／多选／输入表单提交得到真实回复，`scope=session`，无 selector／target／引用及圆球。

[主体原始结果](../verification/polish-final-ui/product-final-5/results.json)保留其后续测试驱动失败的 `success:false`；其中已完成分项不重跑、不重发。剩余步骤通过独立续跑[product-final-11](../verification/polish-final-ui/product-final-11/results.json)闭合：真实 WS 断开、离线重连失败、联网新连接恢复；未发草稿和表单值前后逐字相同，消息数 **25 → 25**。两标签关闭旧页后仍为 open。最后通过真实“确认并结束”及“保留未发送内容并结束”按钮，封存 **27** 条既有／最终确认／marker，全部存在真实消费证据后为 ended；累积测试草稿未提交。浏览器未允许脚本自动关页，`tabClosed:false`；实际 DOM 显示“通信已结束 · 可以关闭此页”，按手动关页分支记录，不冒充自动关闭成功。[功能合并审计](../verification/polish-final-ui/product-functional-summary.json)和[结束文案](../verification/polish-final-ui/product-final-11/ended-ui.json)可逐项核查。

这段功能验证使用 retry 修复后的宿主 launch `c4212554-dbab-4e1e-b1b1-96d553159883`（extension `b014ab19…`），浏览器交付资产与当前构建一致。后续 `b6405080…` 的新增差异是绑定前持久 session 保护及 CLOSED 的 HTTP 分类，已单独通过真实故障／竞态测试；最终性能另在 `b6405080…` 中重启相同 session 并显式 reopen 测量，构建来源不混写。

## 验收矩阵

“自动通过”指真实存储／HTTP／WS 或客户端回归已通过；故障中使用宿主替身的测试不会升级为真实 Pi 证据。

| 用例 | 验证内容与证据层次                                                      | 当前结论                                             |
| ---- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| A01  | 正式 SDK 原生跨段拖选、iframe 外释放、窄屏避让；`verified-summary.json` | 原生浏览器通过                                       |
| A02  | 内容块输入、持久接收后收球；HTTP 明确失败保留草稿的客户端回归           | 自动及真实 Pi 通过                                   |
| A03  | 真实 Pi 空闲自动消费、streaming 时并发排队、上一回合后继续处理          | 真实 Pi 通过，无替代模型会话                         |
| A04  | 接收前后状态及无数字球；精确 consumption 决定橙色                       | 自动／原生及真实 Pi 通过                             |
| A05  | 精确 reply-to、同评论轮次、旧回执与迟到回复隔离                         | 自动通过，见 `polish-review.test.js`                 |
| A06  | 单条完成不改变另一条，持久化恢复；三处真实评论逐条勾选                  | 自动及真实 Pi 通过                                   |
| A07  | 客户端、SDK、服务端剥离整体定位字段；历史回复可访问                     | 自动／原生及真实 Pi 通过                             |
| A08  | 控件不抢点击、queue/send 保留；显式 reopen 恢复表单 gate                | 自动／原生／Pi 表单及上游专项通过                    |
| A09  | 草稿恢复、刷新、版本链重连；原地址重启                                  | 自动及真实浏览器离线通过                             |
| A10  | 同 selector 替换不误挂，缺失目标有未定位历史入口                        | 原生浏览器及自动通过                                 |
| A11  | 最终确认和 marker 全部消费后结束；原请求重试固定集合                    | 自动及真实 Pi 通过；本次关页走手动分支               |
| A12  | 手动结束保留／发送草稿／取消；结束请求不确定时保留身份                  | 客户端及账本自动通过，真实 Pi 结束竞争通过           |
| A13  | 多标签关闭其中一页、不以刷新或意外关闭冒充确认                          | 自动及真实多标签通过                                 |
| A14  | 同 session 两轮真实修改磁盘 HTML、回复、刷新、完成                      | 真实 Pi 两轮通过（构建差异见上）                     |
| A15  | 同构建 direct30 与网页30+3、分段延迟及失败样本                          | 当前构建 direct30 + UI33 全成功，P0 分段门槛通过     |
| A16  | `polish` CLI、skill、build/lint/typecheck/完整测试                      | 1741 自动通过；四项上游浏览器套件均通过              |
| A17  | 持久接收、结束封存、宿主接纳、消费、回复持久化五切点 SIGKILL            | 当前构建真实 Pi 五例通过                             |
| A18  | 忙碌不打断；拒收／未知区分，未消费不提前结束                            | 自动故障注入及真实 Pi 忙碌通过                       |
| A19  | 结束与提交竞争、原结束请求重试、变更载荷拒绝                            | 当前构建真实 Pi 通过：409 CLOSED／200／409           |
| A20  | 宿主接纳后丢回执，重启核实；不确定状态不盲目重投                        | 自动及真实 Pi 故障通过，无重复输入                   |
| A21  | bridge/poll 唯一消费、旧 claim/generation 拒绝                          | 自动及真实 Pi 两种 poll 竞争通过                     |
| A22  | 注册与快照交界、乱序／重复／gap／旧连接、异步关闭                       | 自动、真实 WS 及网页离线通过                         |
| A23  | 宿主身份绑定、Origin/Host、路径、越权写入与结束                         | HTTP／宿主自动回归通过，未削弱原沙箱                 |
| A24  | 旧 frame、source、load token；渲染内容和 URL 安全边界                   | 客户端／SDK／服务端自动回归通过                      |
| A25  | 并发整体消息精确 reply-to，错误／歧义／跨绑定拒绝                       | 自动及真实 Pi 并发消息核对通过                       |
| A26  | 完成验证已查看轮次、实际 HTML digest、当前 load token                   | 自动竞态及真实 Pi 手动完成通过                       |
| A27  | ended 后显式 reopen、新 epoch 与旧回执隔离、原生控件恢复                | 自动及当前构建真实显式 reopen 通过；旧27条输入未重放 |

## 测量口径

最终 Pi 测量使用专用、先启动后绑定的同一会话。源码观测点分别标识 durable acceptance、宿主持久接纳、输入消费、provider request 前的可观察开始、首个可见 text delta、宿主回复持久化和评审回复持久化。模型开始不是对远端实际计算时刻的推断。

网页使用真实点击／输入，逐条保存消息身份与状态。直接输入对照与网页采样顺序执行，不将两组分位数相减当作精确桥接开销。来源与浏览器时钟须用往返采样校准并报告不确定度；观测写盘开销单独记录，不从结果中偷偷扣除。失败、未知和未完成样本保留。

选择结束到浮窗显示的 5 次原生鼠标测量为 **16.3、1.7、1.3、1.2、1.2 ms**，均低于 100 ms；顶层与 iframe 时钟在前后分别校准，最小半往返约 0.08–0.09 ms。[原始选择计时](../verification/polish-final-ui/selection-final-3/selection-timing.json)。这 5 次只用于选择交互，不替代 30 次消息往返采样。

当前最终 `b6405080…` 构建在同一 session 显式 reopen 至 epoch 2，核对旧 27 条 Pi 输入逐对象不变；直接输入对照 **30/30 成功、0 失败、0 未完成**。首可见 token P50 **1272.78 ms**、P95 **2369.81 ms**；完整回复 P50 **1303.34 ms**、P95 **2373.38 ms**。网页采样及前后校准亦已完成；结果见下表。[本轮构建与计时清单](../verification/polish-final-product/runtime/b60b3ea0-79bb-42a8-bf57-cb5ed8e12a43/launches/84e9d8be-711a-400e-bffc-f401a0d67708/final-performance-manifest.json)。

最终网页 **33/33 成功**（30 条整体意见、3 条定位评论），失败／超时／迟到完成／未完成均为 0；三条定位评论均记录真实消费后的橙色和无数字球。网页完整回复 P50 **1695.8 ms**、P95 **3545.1 ms**、最大 **3779.8 ms**。直接对话完整回复最大 **2929.68 ms**。两组按顺序运行、上下文持续增长，不能相减分位数来声称精确桥接开销。

条件：Pi 1.4.0，真实 transcript 记录模型为 `grok/grok-4.7`、provider `magpie`、thinking `medium`；同一个已启动会话，简单定长标签回复，不要求工具调用或文件修改，本机 loopback 桥接。使用实际 provider 网络，未测量远端内部计算时间；这不是复杂修订的完成时限承诺。[条件与模型证据](../verification/polish-final-product/final-performance-conditions.json)。

| 指标                                    | 样本 | P50 ms | P95 ms | 最大 ms | 目标／结论              |
| --------------------------------------- | ---: | -----: | -----: | ------: | ----------------------- |
| 选区结束 → 浮窗                         |    5 |   1.30 |  16.30 |   16.30 | ≤100；5次原生实测均达标 |
| 点击 → 发送反馈                         |   33 |   2.70 |   5.00 |    5.70 | ≤100；通过              |
| 点击 → 本地接收回执                     |   33 |  58.80 |  65.50 |   75.50 | ≤500；通过              |
| 持久接收 → 宿主接纳                     |   33 |  50.61 |  59.01 |   59.07 | ≤1000；通过             |
| 真实消费 → 浏览器处理中可见（校准上界） |   33 |  30.69 |  34.62 |   39.33 | ≤200；通过              |
| 回复落库 → 新回复提示可见（校准上界）   |   33 |  10.63 |  13.60 |   14.86 | ≤200；通过              |

跨时钟两行使用保守上界，包含前后两组校准包络与额外 1 ms 浏览器计时量化误差；源减浏览器偏移范围为 −1.7559 至 +0.8309 ms，未单独观测两次校准之间的漂移。使用精确的 artifact／epoch／message ID 配对 33 条源码事件，没有缺失或歧义样本。[浏览器逐条数据](../verification/polish-final-ui/performance-final-3/ui-results.json)、[校准与逐条区间](../verification/polish-final-ui/performance-final-3/source-to-browser-timing.json)、[按消息类型汇总](../verification/polish-final-ui/performance-final-3/summary.json)。

以下源码同钟分段也均为这 33 条消息，不包含清理时的结束 marker：

| 分段                           |  P50 ms |  P95 ms | 最大 ms |
| ------------------------------ | ------: | ------: | ------: |
| 持久接收 → 预留投递            |   33.82 |   41.74 |   41.76 |
| 预留投递 → 宿主持久接纳        |   17.01 |   19.97 |   21.05 |
| 宿主接纳 → 开始发送            |   13.77 |   14.29 |   14.59 |
| 开始发送 → 真实输入消费        |   17.94 |   23.02 |   24.12 |
| 真实消费 → provider 请求前事件 |   29.93 |   38.50 |   52.32 |
| 真实消费 → 首可见 token        | 1404.14 | 2079.11 | 2111.71 |
| 首 token → 宿主完整回复落库    |   93.30 | 1381.65 | 1558.19 |
| 宿主回复落库 → 评审回复落库    |   17.96 |   22.04 |   22.18 |

观测主写盘开销按这 33 条精确消息的 297 条源码观测记录统计，P50 3.95 ms、P95 5.55 ms、最大 9.94 ms；包含编码、写入和 fsync，不含次级开销日志及故障配置读取。所有耗时保留观测成本，没有扣除以美化成绩。[精确消息源分段汇总](../verification/polish-final-product/runtime/b60b3ea0-79bb-42a8-bf57-cb5ed8e12a43/final-ui-source-summary.json)。

前一候选构建的直接输入对照为 30 成功、0 失败、0 未完成：首可见 token P50 1202.89 ms、P95 1872.42 ms；完整回复 P50 1222.78 ms、P95 1905.63 ms。该轮网页采样发现了后文的问题，不能冒充修复后构建的成绩；最终同构建结果已在上文单独列出。

## 证据与运行边界

### 实际 Pi 崩溃恢复

固定 `b6405080…` 构建，在先有真实对话、已持久化的专用 Pi 会话中测试。每例均在指定源码边界同步记录证据后，仅 SIGKILL 该脚本创建的 Pi；恢复精确 session 文件并重新核对身份。没有用宿主替身或手工写回执冒充恢复。

| 崩溃边界               | 实际结果                                                         |
| ---------------------- | ---------------------------------------------------------------- |
| `accepted_durable`     | 已接收但尚未投递的原消息恢复并得到精确回复                       |
| `end_sealed`           | 原结束 ID 与 final/marker 固定集合恢复，原请求重试不扩展集合     |
| `host_admitted`        | 丢失接纳回执后从宿主账本核实，无重复执行                         |
| `input_consumed`       | 保留 consumed，标记 executionUnknown；不重启该模型请求或重发输入 |
| `host_reply_persisted` | 从真实 Pi transcript 找回已产生的原回复                          |

五例均 **PASS**：同一 session、同一网页端口；每条逻辑消息只有一个真实 Pi 输入与一次宿主 dispatch。各自审计、崩溃前后快照、trace 与清理记录见[运行索引](../verification/polish-final-product/run-index.json)。输入已消费后的恢复不保证任意工具副作用的事务回滚，也不自动续跑无法证实的执行；界面明确报告不确定结果。

### 真实忙碌、竞争与断线

当前 `b6405080…` 构建在 Pi 实际 streaming 时并发提交三条意见，逐条核对原 transcript；真实 WS 被断开后重连，精确回复仍可恢复。结束与普通提交竞争时，结束获胜后的新提交返回 **409 CLOSED**，封存的五个 ID 各有且仅有一次 Pi 输入；原结束请求重试为 200，改变 final 载荷为 409。两种 poll 领取均被 MODE 拒绝，未改变主动桥接权属。

[竞争请求与回执](../verification/polish-final-product/runtime/74606518-21c5-4df0-8590-2fe687f7a05d/race-evidence.json)、[忙碌与 WS 审计](../verification/polish-final-product/runtime/74606518-21c5-4df0-8590-2fe687f7a05d/busy-ws-audit.json)、[五切点同构建汇总](../verification/polish-final-product/five-fault-results-closed-build.json)。这些协议证据不替代浏览器短离线时草稿和表单保留的交互验证。

### 采样中发现的失败，保留原记录

- 旧候选第 17 条超过采样器 90 秒等待上限，约 110.9 秒后自然回复，没有重发。源记录显示 `before_provider_request → first_token` 约 110.6 秒，宿主回复到评审回复持久化约 14.9 ms。没有更细网络证据，不能单独归因于远端模型内部计算。
- 第 19 条遇到连接错误后由 Pi 自行重试，最终成功；旧 host failure 元数据遮住了成功 proof，网页仍显示失败。这是产品缺陷，不归类为正常 provider 终态失败。现已补齐自动重试、新 context 与成功回执清除过时错误、兼容旧账本以及通知优先级的回归。真实恢复后 Pi 输入数量仍为 **19 → 19**，找回原 assistant entry，未重发。[恢复审计](../verification/polish-final-product/runtime/b60b3ea0-79bb-42a8-bf57-cb5ed8e12a43/ui19-recovery-audit.json)。
- 第一个空 Pi 会话在任何真实对话前只分配了 session 路径，未创建文件；接收后崩溃导致无法恢复原身份。原例保留为 **FAIL**。正式保护现于绑定前验证并同步实际 session 文件：空会话返回 409，未创建 artifact 评审或接收意见，用户先在原 Pi 开始一条实际对话即可。没有伪造消息或手写 Pi transcript。[真实拒绝验证](../verification/polish-final-product/runtime/b0a2bba7-4bf7-4639-95f1-baa2a7414c0d/empty-guard-audit.json)。

以上失败与迟到结果不会从采样记录中删除；修复后最终构建的独立采样另行报告。

新增证据位于 [polish-final-product](../verification/polish-final-product/) 与 [polish-final-ui](../verification/polish-final-ui/)。旧产品／M0 窗口保持原样；其中的未知消息没有重放。真实故障只作用于测试脚本自己创建并记录身份的 Pi 进程。全部测试服务仅本机 loopback，不生成凭据、不改变平台权限、不上传数据。

## G01–G07 收尾门槛

| 门槛                 | 证据及边界                                                                                                  | 当前结论                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| G01 当前活动 session | Pi 先启动再绑定；每次实际输入、回复及故障恢复核对 session 身份。普通提交不创建替代会话                      | 真实 Pi 通过                                      |
| G02 自动处理         | 真实空闲消费、连续回合、streaming 期间三条排队；无需用户回聊天框催促                                        | 真实 Pi 通过                                      |
| G03 三级回执         | 源 trace 分别记录 accepted_durable、host_admitted、input_consumed；UI 橙色仅依据最后一项                    | 通过，33条校准计时完整                            |
| G04 外部不确定性     | 丢接纳回执后查原宿主账本，精确消费与回复可核实。消费后执行中断另标 executionUnknown，不误作未投递或自动重跑 | 真实故障通过；不承诺模型工具副作用的 exactly-once |
| G05 恢复与唯一消费   | 同 session／端口恢复，五切点审计、重复结束、bridge/poll 竞争及真实 WS 断线；逻辑消息单次 Pi 输入            | 当前构建真实 Pi 通过                              |
| G06 结束与同步       | 固定结束集合真实消费、409 竞态、权威快照版本链及迟到帧回归                                                  | 协议、故障、浏览器结束及多标签通过                |
| G07 延迟与失败       | 同构建直接30、网页30+3，源／浏览器前后时钟校准，保留失败和迟到样本                                          | 通过，direct30 + UI33 全成功，分段P95达标         |

## 清理与交付边界

最终测试评审已显式结束：当前 epoch 封存 34 条（33 条采样意见及 1 条清理 marker），全部真实消费。旧 60 条 Pi 输入保持原样，仅新增 1 条清理 marker 为 61 条；未重放历史未知消息。自有 Pi `42958`、supervisor `42944` 与最终浏览器／daemon `41642`／`41641` 均已退出，相关旧功能浏览器及 isolated fixture 也已确认清理。原用户原型 `95933`／`49792` 保留，未触碰。

[Pi 结束与清理审计](../verification/polish-final-product/runtime/b60b3ea0-79bb-42a8-bf57-cb5ed8e12a43/launches/84e9d8be-711a-400e-bffc-f401a0d67708/cleanup-audit.json)、[浏览器清理](../verification/polish-final-ui/performance-final-3/cleanup.json)、[全部运行索引](../verification/polish-final-product/run-index.json)。实现、构建和开发书均在本地工作区；未提交、推送或发布。
