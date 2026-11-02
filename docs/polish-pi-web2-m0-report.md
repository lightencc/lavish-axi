# Pi 第二次真实网页窗口记录

日期：2026-10-31，Asia/Shanghai。此报告为已完成窗口的事实记录，不代表产品或完整 M0 验收通过。

- 实际监听：00:14:48.532；关闭：00:24:08.227；持续 559.695 秒，早于 600 秒硬截止。
- 地址：127.0.0.1:49793；监督进程 89379、Pi 进程 89463 均退出；49793 无监听。49791/49792 的原型 PID 33191/95933 保持不变。
- 绑定 Pi session：`01a18d97-a652-715c-8d56-71655bfa011d`，同一实例内接收本轮全部消息。
- 运行的是 r3 隔离验证页，使用生产 SessionStore 与真实 poll handler；不是正式评论 UI。新增 launcher 仅暴露既有 peer 给 stdin 监督器，无额外管理路由。

| 检查 | 本轮事实 |
| --- | --- |
| 真实网页投递和 SSE 状态 | 观察 accepted、host_queued、delivered、replied；仅真实消费后 consumed=true |
| 同版本回复恢复 | 首次 query 在浏览器收到响应后主动丢弃；手动刷新得到相同 version=7，再次 query 补回 W2_ACK，无第二次 submit |
| 刷新恢复 | 重载页面后恢复前三条输入及 W2_ACK/W2_RECOVERED/W2_POLL |
| 宿主接纳回执丢失 | 暂停消费，丢失 admit 回执，账本 unknown；按原身份查询获得 queued 证明，随后消费回复，无盲重投 |
| bridge/poll 权属 | bridge 时真实 HTTP poll 返回 409/MODE；切换 poll 后 POST takeover 返回 delivery，HTTP 返回时 consumed=false；再由适配器交给同一 Pi |
| 结束排空 | 暂停宿主后最终消息 host_queued、标记 accepted，生命周期 ending；恢复消费后进入 ended，最终消息和标记均 consumed |
| 断线重连 | 使用浏览器 Offline 模拟，但现存 SSE 未断开，未观察断线提示；本轮不算通过 |
| 30 条性能与直接 Pi 对照 | 未完成；仅三个普通输入和一个最终确认，加一个结束标记，不足以报告 p95 或性能达标 |

首个浏览器样本：持久接收可见 96.3ms、真实消费可见 110.9ms、回复状态可见 38,799.2ms（均为同一浏览器 performance 时钟差）。回复正文恢复延迟含人为故障及人工等待，不能当正常响应指标。Node 工具执行位置和浏览器时钟未完成可信校准，不报告跨时钟精确延迟。

发现未闭合问题：同版本 query 恢复后，正文已显示，但错误 notice 未清除。实际网络断开、完整性能采样、生产集成和两轮真实修改仍需后续验证。

证据目录：[verification/polish-pi-web2-m0/evidence](../verification/polish-pi-web2-m0/evidence)。主要文件：window.json、identity.json、supervisor.jsonl、web-events.jsonl、host-entries.json、host-inbox.json、browser-reply-repaired.json、browser-before-reload.json、browser-ended.json、poll-post-takeover.json、ending-paused.json、cleanup.json。历史证据按 baseline 中的 228 条清单再次核对，结果见 cleanup.json；未重放历史未知消息。
