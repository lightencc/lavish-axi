# 下一轮网页验证计划 r2（尚未运行）

本轮只准备文件和纯接口测试，不启动监听。候选入口为 `serve-prepared.js` 导出的 `startPreview()`，导入模块不自动执行。必须由父任务取得新的监听授权后才调用。

## 明确范围与清理

- 唯一监听：`http://127.0.0.1:49793`，不使用 0.0.0.0、LAN 地址、附加端口或远程转发。最多监听 600 秒。
- 顺序：专用 Pi 启动并 ready → 记录 PID／instance／session → coordinator ready → 再查询 Pi 身份 → bind。bind 失败退出自有进程，不尝试其他端口、不停止占用者。
- 新 runtime UUID、消息 ID 和会话目录。网页绑定这个预先启动的专用 Pi；不把它冒称用户原 Codex 或其他既有工作会话。
- 到时限、Pi／coordinator 退出或信号终止：关闭 SSE 与 HTTP socket、停止自有 coordinator 和 Pi、记录退出。随后 lsof 检查 49793 释放，核对 49791／49792 仍为原 PID 33191／95933。
- 浏览器关闭不立即终止 supervisor；服务期限内 final drain 可继续。服务到期仍有未消费输入时保留 unknown／ending 和原始证据，不擅自重发或延长。

## 已准备接口

| 接口 | 契约 |
| --- | --- |
| GET `/`、`/page.js` | 会话级提交验证页；没有元素定位或圆球，不冒充正式交互 |
| GET `/binding` | 绑定的 artifact、instance、session 和 epoch |
| POST `/submit` | `scope: session`，携带绑定、epoch、稳定 id、text；selector 等额外字段拒绝 |
| POST `/query` | 服务端从账本重建精确身份后查宿主；不存在返回 unknown，never safeToResend |
| GET `/snapshot` | 权威当前列表、状态、version；刷新不依赖旧 DOM 或仅浏览器缓存 |
| GET `/events` | 同端口 SSE；先订阅后取快照；重连发完整最新快照，version 拒绝回退，15 秒 heartbeat |
| POST `/end` | 固定最终提交与 marker；ending 排空；消费完成才 ended |

请求检查 origin／referer、HTTP Host、绑定及 epoch。网页不拥有 reconcile／claim 接口。状态和事件来自 coordinator；输入消费不由浏览器声明。用户和 agent 文本均以 textContent 展示。未确认发送保留草稿及稳定请求身份，不自动重发。

## 浏览器用例与证据

1. 同一专用 Pi 正常投递、消费、回复；保留 Network、网页快照、宿主业务事件和源文件哈希。每条消息恰好匹配一个真实输入 entry。区分 admission 与 consumption，橙色仅在 consumed 后。
2. 新提交并等待回复；刷新整页恢复全部记录与回复，不依赖存活的 JS Map。截图分别采集、分别核对哈希。
3. 网络断开期间生成 reply／ended；恢复后快照重建事实，新回复／结束状态可见。测试旧连接延迟事件与重复版本，不能回退。SSE 只保证最新事实恢复，本阶段不承诺历史 transient toast 逐条重播。
4. 真实忙碌 Pi 上新输入有序排队；结束时已有输入＋最终反馈＋marker 固定，不接纳新输入；最后 consumed 后 ended，不等模型回复。关闭网页后 coordinator 继续排空。页面 end 不主动杀死 Pi。
5. 跨 origin／referer、错误 session、旧 epoch、伪造 selector、重复不同载荷拒绝。非监听 handler 测试通过不能代替浏览器安全测试。
6. 原生 legacy poll 并发用例当前仍没有生产裁决适配：不得在这个预览服务中声称已覆盖。M0 G05 独立保留未完成。

## 30 次分阶段响应测量

运行 30 条唯一新消息，固定测试文本、模型和思考设置。顺序提交为正常路径样本，忙碌队列另组测量；失败、超时和未知也保留，不选择性丢样。网页 `window.polishM0Samples` 保存提交、接纳可见、消费可见、reply 状态可见、回复文本可见的 performance.now 时间。

宿主／桥接日志记录 dispatch-to-host、宿主持久 admission、context_with_system、first text delta、持久 reply、coordinator version。首个文本增量只记时间与已确认的输入 ID，不导出思考或 token 内容。`first-text-token` 是可见文本首 token，不能当作模型内部开始推理。

计算提交→接纳 UI、接纳→宿主 admission、排队→消费、消费→可见首 token、消费→持久 reply、reply→网页状态、reply→文本可见。跨浏览器与 Node 时钟先采集基准偏移并声明误差；同域间隔优先使用同一时钟。输出每段 p50/p95/最大值与原始 30 行，不把整个模型耗时归为桥接延迟。

直接 Pi RPC 对照需要另列同模型、同设置的 30 个新输入，交替顺序并记录上下文长度／负载差异；不能凭当前 5 条组件消息或旧 30 次 query 轮询数据宣称已达到与直接聊天同速。若 10 分钟不足，停止并标记未完成，不静默延期。

本轮未运行浏览器、没有 30 个新性能样本；这些均为待验收项。
