# Polish M0 补充验证报告

日期：2026-10-30（Asia/Shanghai）。结论：**仍为 NO-GO；本轮仅补充接入机制证据，不进入 M1–M3。**

本报告补充 [首轮报告](polish-m0-report.md)，不替换或修改其证据，也不降低 [开发书 v1.1](polish-development-spec.md) 的门槛。最新意见已在开发书 §3.2、R10、A07 明确：整体提交没有网页元素锚点，不高亮、不产生内容圆球；回复归入整体意见入口。原型尚未落实这一修正，不能视为已交付。

## 1. 边界与结论

本轮读取 Codex 官方文档和已安装 CLI 帮助，检查 Pi 1.4.0 的公开扩展接口及实现，并在自有隔离 Pi 进程中运行一次有限实验。没有创建监听端口、启用远程控制、配对设备、生成持久凭据或修改安全设置。没有发送 Codex 测试 prompt，没有重投首轮 `fault-active`／`fault-queued`；没有修改生产 `src`、原型或全局配置，没有提交、推送、部署。

新增证据证明：Pi 扩展可把外部消息 ID 放入结构化 `details`，在输入事件、会话记录和恢复后的只读查询中保留身份；本地账本可以阻止同入口的重复提交。它**尚未证明**宿主持久排队回执、任意崩溃窗口可恢复、完整回复身份链，以及桥接和原生 poll 的唯一消费权。Codex 当前桌面实例的可用本地接入口仍未建立。

## 2. Codex：接口存在不等于当前实例可连接

本机独立 CLI 为 0.165.0，桌面内置 CLI 为 0.166.0-alpha.5.1；帮助输出见 [cli-readonly.json](../verification/polish-m0-supplement/evidence/cli-readonly.json)。首轮记录的当前桌面 chat 为 `01a18c17-e9a9-7d03-b0dd-be4bf21f18ad`，app-server 使用 stdio；当时未找到可用的默认控制 socket。本轮未另起 app-server 来冒充该实例。

| 候选 | 官方能力与本轮判断 |
| --- | --- |
| `codex queue --thread` | 官方支持向已有会话排队，`--remote` 可指定端点。前提仍是连接持有目标活动会话的正确实例；本轮未获得该端点。不能把会话 UUID 当作连接凭据。[Developer commands](https://learn.chatgpt.com/docs/developer-commands) |
| App Server | 提供消息与会话协议；默认 stdio，显式 `--listen` 提供客户端传输。启动新的服务器不证明连接现有桌面实例。`--code-mode-host` 是出站执行连接，不是可供 Polish 注入消息的入口。[App Server](https://learn.chatgpt.com/docs/app-server) |
| Remote connections | 官方桌面远程访问需要用户启用连接并配对；尚未证明任意本地 Node 服务有受支持的接入方式。本轮没有启用或配对。[Remote connections](https://learn.chatgpt.com/docs/remote-connections) |
| 原生 annotation API | 内置浏览器可对元素或文字范围请求原生评论 UI，需安全顶层页面、能力探测及相关许可。请求获接受不表示已发消息，必须由用户提交。它改变现有一步发送及 iframe 交互边界，不能直接替换已确认方案。[Annotations Extensibility](https://learn.chatgpt.com/docs/annotations-extensibility) |
| Site tools / WebMCP | 页面向 agent 暴露操作能力；所查文档没有证明页面可主动唤醒当前空闲 agent，因此不作为网页到会话的投递接口。[Site tools](https://learn.chatgpt.com/docs/webmcp) |

上述来源读取日期为 2026-10-30。这里的“未证明”不是断言平台永远不支持。当前 agent 可调用的会话工具也不是任意本地服务的公共 API，不能搬用其内部凭据或通道。

如继续探索需新增动作，具体边界是：为桌面 app-server 开监听／更改启动方式、在 Connections 中启用远程访问与配对、或启用页面 annotation 权限。本轮均未执行；前两者还必须先证明目标仍是当前桌面活动实例。单纯开一个新服务不能解除 G01 阻塞。

## 3. Pi 公开扩展接口与持久性限制

安装包位置及源码哈希见 [pi-source-manifest.json](../verification/polish-m0-supplement/evidence/pi-source-manifest.json)。依据为安装版 `docs/extensions.md`、`docs/session-format.md`、`dist/core/extensions/types.d.ts`、`agent-session.js` 和 `session-manager.js`。

- `pi.sendMessage` 支持 custom message 的 `details`、`triggerTurn` 和 `deliverAs: followUp`；返回值为 void，不能当作宿主持久排队回执。`sendUserMessage` 没有相同的结构化外部 ID 参数。
- `ctx.sessionManager` 提供当前分支的只读查询。custom message 的 `details` 可持久保留；这比正文标记匹配更可靠，但已保存输入不等于对应模型执行已完成。
- `pi.appendEntry` 不能直接当作落盘确认：新会话尚无 user／assistant 消息时，记录可能只在内存。本轮确实观察到 `inMemory: true`、`fileExists: false`。
- 输入事件与消息持久化存在时间差；已查实现没有在上述会话写入路径显式 fsync。不能声称断电持久性，也不能用“事件先出现”排除随后的崩溃窗口。
- 扩展命令异常会被宿主捕获并报告扩展错误，RPC 仍可能返回 `success: true, disposition: handled`。这一响应只能说明命令路由已处理，不能冒充业务成功。

## 4. 单次隔离实验结果

原始事件见 [extension-events.jsonl](../verification/polish-m0-supplement/evidence/extension-events.jsonl)，提取与断言见 [experiment-summary.json](../verification/polish-m0-supplement/evidence/experiment-summary.json)。日志使用 UTC；以下时间为 Asia/Shanghai。

| 项目 | 实际结果与适用边界 |
| --- | --- |
| 身份 | 18:45:26–18:45:34，原进程 PID 57082，隔离 session `01a18c6a-1d1d-7127-a872-7179f9801fe4`；恢复 PID 59931。后者只读查询同一历史，明确不是原活动实例 |
| 模型 | 沿用 `magpie / grok/grok-4.7`，thinking medium；隔离工作／会话目录，无模型工具、MCP 或项目上下文；仅显式加载实验扩展 |
| 本地去重 | `supp-normal-001` 用两个不同 RPC 请求 ID 提交两次；一次 fresh、一次 duplicate，只观察到一个相同结构化 ID 的 custom input 和一次 `SUPP_ACK_normal` 回复 |
| 身份持久化 | 正常消息携带 session ID、external ID、载荷摘要；恢复只读查询找到同一宿主条目 `12e78f7a` 及一致的 details |
| 载荷冲突 | 单测证明同 ID 异载荷抛出 CONFLICT；实跑未新增输入或改变摘要，但 RPC 返回 handled。采集器没有保存独立的扩展错误事件，故不宣称已经有客户端可用的冲突拒绝回执 |
| 单写者 | 独立 Node 子进程申请同一账本写锁得到 EEXIST。只约束此扩展入口；没有覆盖原生 RPC、poll 或其他消息路径 |
| 崩溃窗口 | `supp-unknown-001` 已记录 dispatching，在调用 sendMessage 前受控暂停；只终止自有 PID 57082。恢复后侧账本仍为 delivery_unknown、宿主分支无该输入，未自动重投，旧锁保留 |
| 清理 | 恢复 PID 59931 正常退出；后续只读检查两个 PID 均不存在。保留测试历史、侧账本和旧锁用于核验 |

实验监督器知道故障注入发生在实际调用之前，但恢复算法只凭账本无法证明宿主未收到，因此保持未知。此实验不是“宿主已收、回执丢失”的新证明，也没有修复首轮 queued 消息在重启后丢失的问题。正常回复通过串行实验与固定文本核验，尚未实现生产级 `reply_to`／round 关联。

侧账本写入调用 fsync，仅证明本轮进程崩溃后观察到记录保留；没有做断电测试或目录持久性验证。崩溃后保留锁会阻止自动接管，这是保守停止策略，不是完整恢复能力。五项单测通过；初次失败日志和测试清理顺序修正记录均保留，未将测试夹具失败归因于宿主。

## 5. G01–G07 更新

| 门槛 | Codex | Pi（含首轮结果） | 本轮变化 |
| --- | --- | --- | --- |
| G01 同一活动 session | BLOCKED | BLOCKED | 新隔离实例证明扩展内绑定身份，不证明用户原活动 Pi／网页接入；Codex 端点未建立 |
| G02 自动处理 | BLOCKED | PASS，仅首轮隔离 RPC 范围 | 扩展正常消息能触发回复；本轮没有重新完成扩展忙碌排队矩阵 |
| G03 三级回执 | NOT RUN | BLOCKED，身份关联子项改善 | 输入结构化身份与历史查询成立；没有独立持久排队回执，不能把 handled 当接收 |
| G04 未知结果与幂等 | NOT RUN | FAIL，完整门槛不变 | 本地去重与未知停机成立；原生 RPC 重复执行事实不变，宿主幂等或可靠排除执行仍未证明 |
| G05 恢复与唯一消费 | NOT RUN | FAIL，完整门槛不变 | 局部写锁有效；跨入口唯一消费、未知后的安全接管及排队恢复未通过 |
| G06 结束排空与重连同步 | NOT RUN | NOT RUN | 没有正式桥接／状态流实现；实验进程退出不算 Polish ended |
| G07 延迟与失败 | NOT RUN | NOT RUN，完整门槛 | 保留首轮 30 次原始 RPC 样本；本轮仅机制样本，不新增 P95 或网页性能结论 |

## 6. 后续产品决策与停止点

1. **维持 v1.1。** 需要先取得受支持的当前宿主入口，补齐持久排队／未知查证证据，再按原门槛评估。现有自定义浮窗、整体无锚点提交和橙色处理语义不变。
2. **考虑 Codex 原生 annotation 作为另一个方案。** 代价是内置浏览器、顶层页面、原生编辑／人工提交与权限边界；其可接受回执不是 agent 消费。还需重新确认整体无锚点意见、原生表单和完成／结束语义。未经产品决策不采用。
3. **继续研究 Pi 扩展。** 本轮为结构化身份提供候选机制，不能据此把双宿主要求自动缩减为 Pi-only，也不能降低崩溃恢复保证。

本轮停于补充报告，供独立复审；没有启动 M1–M3。开发书 v1.1 和首轮清单内 21 个文件均保持原哈希；补充文件完整性见 [manifest.json](../verification/polish-m0-supplement/evidence/manifest.json)。
