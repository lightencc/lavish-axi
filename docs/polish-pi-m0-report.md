# Polish Pi 专项 M0 报告

日期：2026-10-30（Asia/Shanghai）。对应 [开发书 v1.2](polish-development-spec.md)。**Pi M0 尚未通过；Codex 后置，不作为本阶段阻塞条件。没有进入 M1–M3。**

## 1. 本轮范围和证据

用户选择优先推进 Pi。本轮保存 v1.1 快照，更新阶段范围，完成隔离的持久 inbox、宿主扩展、最小桥接及网页验证入口。现有原型和生产源码未改动。没有新增监听、远控配置、凭据、安全权限、外部上传、提交、推送或部署。原有未知消息均未重投。

| 交付 | 路径 | 状态 |
| --- | --- | --- |
| 阶段范围与技术契约 | [开发书 v1.2](polish-development-spec.md)、[v1.1 快照](../verification/polish-pi-m0/evidence/development-spec-v1.1.md) | Pi 优先；原 G01–G07 技术标准保留 |
| 验证顺序和边界 | [PLAN.md](../verification/polish-pi-m0/PLAN.md) | 已记录，不代表产品开发放行 |
| 持久接收、身份和查询 | [inbox.js](../verification/polish-pi-m0/inbox.js)、[host-extension.js](../verification/polish-pi-m0/host-extension.js) | 组件实验通过；非生产实现 |
| 既有实例 RPC 绑定与桥接 | [peer.js](../verification/polish-pi-m0/peer.js)、[bridge.js](../verification/polish-pi-m0/bridge.js) | 实例先运行、后绑定；只操作自有测试进程 |
| 网页验证入口 | [index.html](../verification/polish-pi-m0/index.html)、[serve.js](../verification/polish-pi-m0/serve.js) | 已准备；未启动监听，未做浏览器运行验证 |
| 本地契约测试 | [all-green.txt](../verification/polish-pi-m0/evidence/all-green.txt) | PASS，10 项；包含真实磁盘读写，无监听 |
| Pi 实跑 | [component-events.jsonl](../verification/polish-pi-m0/evidence/component-events.jsonl)、[component-summary.json](../verification/polish-pi-m0/evidence/component-summary.json) | PASS，仅组件范围；没有网页端到端证明 |
| 实跑断言与清理 | [assertions.json](../verification/polish-pi-m0/evidence/assertions.json) | 三条消息各一次 dispatch、一次处理输入、一次回复；测试进程已退出 |
| 源码依据 | [pi-source-manifest.json](../verification/polish-pi-m0/evidence/pi-source-manifest.json) | Pi 1.4.0 已安装公开文档及实现的哈希；与补充轮一致 |

## 2. 最小方案与信任边界

目标路径为：网页 → 桥接持久记录 → 已绑定 Pi 的公开扩展命令 → 宿主扩展持久 inbox → 当前 Pi 的处理输入 → 已落盘回复条目 → 查询／网页。

本轮实际运行从桥接组件开始，**没有经过网页**。桥接创建前已启动专用 Pi 进程，取得随机实例 ID、宿主 session ID 和 PID。桥接只使用该进程既有 RPC 管道；网页不能指定 session、命令、路径或 selector。一次进程承载本轮全部消息，不按请求重建会话。

持久接收分为两层：桥接先保存本地记录，宿主扩展再保存其 inbox，之后才返回业务接纳回执。写入采用临时文件、文件 fsync、rename 和目录 fsync。这个回执说明**该 Pi 进程内扩展的持久 inbox 接纳**，不是 Pi 原生 followUp 的持久排队承诺，不表示模型开始或完成。RPC `handled` 不参与成功判断；业务回执包含独立请求 ID、绑定身份、消息 ID 和摘要。

扩展仅在宿主空闲且无 pending message 时取 inbox 的下一条消息；调用 `sendMessage` 前持久记录 dispatching。`context_with_system` 事件中找到同一结构化 custom message 才记录处理输入证据；这比 message_start 更接近处理输入，但不是模型首 token 或成功执行证据。本实验没有其他扩展修改上下文，也没有工具调用。

回复取自 `turn_end.messageEntryId`，然后以 Pi 当前分支查询核对：输入 details 身份／摘要一致，回复条目 ID 存在且为 assistant，内容及停止原因与已记录结果一致。正文仅用作内容一致性校验，不用于寻找消息或猜测归属。`getBranch()` 是当前会话历史的正向查询，不是宿主执行事务查询；空结果不能授权重投。

HTTP 接口代码使用固定 `127.0.0.1:49793` Host 和同源 Origin／Referer 校验，拒绝转发 Host 与客户端路由字段，限制请求大小。页面使用 textContent，整体提交无元素定位。未知投递保留原提交和查询入口，禁止用同一未决草稿自动创建新消息重发。以上只是已准备代码及接口测试结果；未经过真实浏览器，不能声称网页安全／交互验收完成。

## 3. 本轮实跑结果

专用 Pi 原进程 PID **56265**，实例 ID `6903cd15-41ce-456f-934f-ae3f3074d93e`，session `01a18c8b-4d64-77e6-8bdc-b89cafe279c4`。精确时间在原始事件中使用 UTC；模型沿用 `magpie / grok/grok-4.7`，thinking medium。无工具、MCP、其他扩展或项目上下文；唯一显式扩展是本轮测试文件。

先用标记 setup 消息建立会话，再记录身份、创建桥接。此后全部请求均进入同一已运行进程。新增业务消息为：

- `pi3-27047d06-e6c4-45b5-b496-98666ac4f60a`
- `pi3-04861c4c-6fe8-4a45-99b3-9bf354a7d1b1`
- `pi3-29846f3c-1e46-49ac-8758-8e213ece06e5`

三条消息各有一次 dispatch、一次 context 输入证据和一个可核对的持久回复条目。第一条重复提交只查状态，未二次派发；同 ID 改载荷被拒绝。前两条在第一条开始处理前已接纳，证明串行排队处理，**不构成“宿主忙碌期间新请求到达”的专门验收**。

第三条注入“宿主已返回接纳，但桥接收不到该业务回执”：测试适配器故意隐藏已取得的回执，桥接进入 delivery_unknown。随后只调用 query，查到同一宿主、同一消息的正向证据并核验回复；没有重试 admit 或重新启动会话。这验证了该明确窗口的恢复方式，不是实际断网或宿主崩溃测试。

原进程正常退出后，仅从保存的 host inbox 和 Pi 历史读取三条证据，全部核验通过；没有启动恢复宿主、没有重放消息。这证明本轮正常退出后的正向可查询性，不证明断电持久性、任意分支／压缩恢复或崩溃后的自动续跑。

## 4. 宿主调用与持久记录之间的窗口

| 窗口 | 当前可证实的处理 | 仍缺少的保证 |
| --- | --- | --- |
| 桥接本地 accepted，尚未调用宿主 | 保留原 ID／摘要；单一实例可首次投递 | 桥接进程重启后重新连接仍活动 Pi 的完整机制未验证 |
| 宿主 inbox 已落盘，接纳回执丢失 | 对同一存活实例做身份绑定 query，本轮实际恢复成功 | 进程崩溃／重启情形不能由这个正常实例实验推导 |
| 宿主 inbox accepted，尚未 dispatch | 落盘记录可区分尚未派发；当前实例空闲时顺序取出 | 接管、实例代次变化和 pending 自动恢复未验证 |
| dispatching 已落盘，调用是否发生不明 | 停未知，不再取此消息；没有记录不代表没执行 | 公开 sendMessage 与 sidecar 不构成原子事务，不能安全自动重投 |
| context 输入证据已落盘，模型尚未完成 | 可报告曾进入处理输入；不重复投递 | 不能宣称模型成功、工具副作用恰好一次或回复必然可恢复 |
| Pi 回复条目已落盘，sidecar 关联尚未保存 | 保留未知／待核实，不用相邻正文猜 reply_to | 需要宿主原子保存输入／回合／回复关联；当前适配器未覆盖 |
| sidecar 回复与宿主条目均保存 | 本轮通过结构化查询恢复已知回复 | 分支变更、压缩、损坏、磁盘写失败和断电未验收 |

因此没有将本地去重、appendEntry、历史中的 custom message 或输入事件升级为 exactly-once。旧未知消息仍保持未知。实验写锁只限制此 inbox 的单写者，未整合 lavish poll 的跨路径消费权。

## 5. Pi G01–G07 状态

| 门槛 | 状态 | 本轮证据与未完成项 |
| --- | --- | --- |
| G01 当前已运行 session 全链路 | **BLOCKED** | 组件内先启动后绑定、前后 PID／实例／session 一致；[身份与回复](../verification/polish-pi-m0/evidence/component-summary.json)。网页入口未启动，不能标 PASS |
| G02 空闲／忙碌／回合后自动处理 | **BLOCKED（完整门槛）；组件子项 PASS** | 三条自动顺序处理，无人工催促；首轮原生 RPC 忙碌证据保留。本轮扩展的忙碌到达、掉线恢复、真实网页唤醒尚未验收 |
| G03 接纳与真实消费分离 | **BLOCKED（端到端）；组件子项 PASS** | 本地持久记录、宿主扩展持久接纳、context 输入证据与 turn_end 条目分开；[原始事件](../verification/polish-pi-m0/evidence/component-events.jsonl)。无浏览器橙色状态证据，不承诺原生队列持久性 |
| G04 丢回执、未知及幂等 | **FAIL（完整门槛未解除）** | 同存活实例的丢接纳回执可查询恢复；[断言](../verification/polish-pi-m0/evidence/assertions.json)。宿主调用／落盘间崩溃仍不可判定；不盲重投只是安全停止，不是恢复通过 |
| G05 重启恢复与唯一消费 | **FAIL（完整门槛未解除）** | 单写锁及未决不再次派发测试通过；跨入口 poll、bridge 与 Pi 重启／重新绑定未验证。当前运行器持有 RPC 管道，不能宣称桥接重启可透明接回旧进程 |
| G06 结束排空与无漏重连 | **NOT RUN** | 验证页只有 submit/query，未实现 ending／ended 或实时快照通道；正常关测试进程不算结束验收 |
| G07 性能与失败样本 | **NOT RUN（完整门槛）** | 全部本轮请求／未知／结果保留；未做 30 次网页采样和直接聊天对照，不从 3 条组件样本给出产品 P95 |

Codex：**后置、NOT RUN（本阶段）**。已知入口限制仍见 [补充报告](polish-m0-supplement-report.md)，未来独立完成 G01–G07；不是 Pi 的阻塞项，也不是已支持。

## 6. 需要独立审证的设计选项

1. **维持当前全部契约。** 需要将宿主接收、投递代次、处理回合与回复关联纳入可查询的宿主事务／幂等协议，或取得具有同等保证的受支持接口。桥接重启还需要独立于网页服务的存活宿主通道及受控接管。代价是更多宿主集成工作；当前公开 API 加 sidecar 还不够。
2. **保留未知并人工核实。** 当前方案能安全停机并展示可核实的正向证据，但不能满足完整恢复门槛。若选择这种产品能力，必须显式修改需求；本轮没有降低标准，也不提供无证据的安全重发。
3. **先补真实网页证据。** 能验证输入到现有 Pi、状态及回复的具体链路，帮助定位交互延迟；不能自动消除第 4 节的恢复缺口，也不因此放行 M1–M3。

## 7. 精确的监听阻塞与最小请求

来源是本轮方向更新中的明确限制：“不得新增监听/远控配置”；真实网页需要新增监听时，应停止该步骤并提出准确请求。现有 `127.0.0.1:49791`／`:49792` 属于用户原型，不接管或改绑。只读检查显示 `49793` 未监听。

待允许的具体动作：在项目目录执行 `node verification/polish-pi-m0/serve.js`，先启动一条标记明确的专用 Pi 测试会话，记录身份，再仅绑定 **127.0.0.1:49793** 提供该验证页及 submit/query/binding。最多运行 10 分钟，退出时只关闭自有服务和测试 Pi 子进程；不改平台配置，不生成持久凭据，不开放局域网。用户的其他会话不受操作。

本轮没有执行该命令。已完成所有不依赖此监听的上述工作，停止于 Pi M0，等待独立审证和该具体步骤的明确许可。最终检查与完整性清单见 [checks.json](../verification/polish-pi-m0/evidence/checks.json)、[manifest.json](../verification/polish-pi-m0/evidence/manifest.json)。
