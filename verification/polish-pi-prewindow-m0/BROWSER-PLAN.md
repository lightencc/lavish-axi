# r3 唯一受控网页窗口计划（准备完毕，尚未授权启动）

仅候选 **127.0.0.1:49793，最多 10 分钟**。禁止改用其他地址／端口、延期或重启窗口来绕过时限；不得触碰 49791／49792。父任务须另取新许可，本文件和本轮任务都不构成监听许可。

## 服务、数据与身份范围

入口为 r3 `serve-prepared.js` 的 `startPreview()`，无顶层自动启动。每次新建 `verification/polish-pi-prewindow-m0/runtime/<uuid>/`，其中唯一 artifact 为 `fixture.html`，唯一 SessionStore 为 `state.json`，Pi history 和 host inbox 同处这个新运行目录。不读写之前 runtime 的消息，不接入其他 artifact 或既有工作会话。

专用 Pi 先 ready，记录 PID／instance／session，随后建立 runtime 并再次查询 Pi 身份；之后唯一 Express/Node HTTP 服务才 bind。该服务同时承载原生 poll 与页面接口，没有第二个 poll 服务、WebSocket 端口或 sidecar listener。

所有请求要求 Host 精确为 `127.0.0.1:49793`，存在的 Origin／Referer 也必须同源。网页不能选择其他会话。`/api/poll` 的 file 参数必须与 ready 中给出的规范化 artifact 路径完全相同，先拒绝其他路径，再进入真实处理器。

## 路由和方法白名单

| 方法／路由 | 用途与边界 |
| --- | --- |
| GET `/`、`/page.js` | r3 静态验证页；简约样式；整体意见无元素锚点 |
| GET `/binding` | 返回本实例 binding、epoch |
| POST `/submit` | JSON：binding、epoch、稳定 id、text、scope=session；不接纳 selector |
| POST `/query` | JSON：binding、epoch、id；服务端查精确宿主身份，只读补回复，不重发 |
| GET `/snapshot` | 同一 SessionStore 的 version／lifecycle／消息快照 |
| GET `/events` | 同端口 SSE，完整初始／重连快照、后续事件、15 秒 heartbeat |
| POST `/end` | JSON：binding、epoch、结束 id、可选 final；固定集合＋marker 的消费排空 |
| GET `/api/poll?file=<唯一 artifact>&timeoutMs=<受控值>` | 原生 `createPollHandler → SessionStore.takeFeedback`；默认 bridge 模式拒绝 poll，切为 poll 模式后从同一账本领取 |
| POST `/api/poll?file=<唯一 artifact>&takeover=1&timeoutMs=<受控值>` | 原生 takeover 路径，JSON `{}`；仍受模式／代次／未决账本约束 |

绑定会话不接受 `agent_reply` 自行声称完成；回复只能由受信 Pi 回执适配器写入。测试由同一 supervisor 通过返回的 runtime 对象切换 bridge／poll 模式，没有开放 mode、recover、reconcile 或新会话管理 HTTP 接口。未列静态资源／路径不提供。

本窗口不用 CLI `pollCommand` 启动服务：它的 ensureServer 可能尝试另起监听，且本受控服务不提供通用 `/health`／完整 CLI 控制面。网络用例直接请求上表真实 `/api/poll` 路由，把完整响应交给当前 runtime.deliver；这验证原生 handler 与传输，不能写成完整 CLI 启动链路已测。CLI 的 delivery 字段保留已另作纯序列化测试。

## 时间与清理

监听成功时记录起点并设置不可续期的 600000 ms timer。端口被占用立即失败，关闭自己创建的 server/review/Pi，不停止占用者、不尝试备用地址。Pi 退出、review 终止、server 错误或用户停止也触发清理。

先停止 HTTP/SSE 并销毁自有连接，随后关闭 review；未决账本保留 unknown／ending；最后给自有 Pi SIGTERM，必要时 2 秒后 SIGKILL，只操作持有的 ChildProcess。不得为了排空而延长监听期限。运行结束核对 49793 无监听，49791／49792 PID 仍为 33191／95933，所有自有进程已退出。检查结果保存到新 evidence，不覆盖旧证据。

## 必测流程

1. 浏览器整体提交到同一专用 Pi，分别观察 accepted、host_queued、真实 consumed、reply；橙色只表示已消费到回复期间。4xx／未知保留输入，不盲重发。
2. 首次 `/query` 失败后手动刷新和 SSE 重连，同版本快照仍补到回复；旧版事件不回退；全页刷新恢复消息及回复。不得用再次 submit 修复回复缺失。
3. 默认 bridge 模式实际 GET/POST poll 被裁决拒绝；切 poll 后真实 HTTP 响应包含原始身份，response 写出仍未 consumed。由 supervisor 适配到同一个 Pi，验证只消费一次。重复响应、旧代次、poll takeover／断开和 bridge 竞争不得绕过账本。
4. 丢接纳回执后保持 unknown，以宿主原身份正向查询；不存在／空历史仍 unknown，禁止重发。
5. 浏览器掉线时生成 reply／ended；重连快照恢复事实和提示。同版本补回复复测。不同截图分别采集并核对哈希，不把重复图片当不同状态。
6. 忙碌 Pi 上已有输入＋final＋marker 固定排空，晚到新消息拒绝；marker 消费前仍 ending，消费后 ended，无需等待模型答案。关闭浏览器后排空继续，但不越过窗口硬截止。

## 响应效率：30 次分阶段样本

保留 30 条唯一新输入及失败样本，固定模型、思考设置和测试文本；正常串行与忙碌队列分组。网页保存提交、接纳可见、消费可见、reply 状态可见、正文可见的 performance.now；host／runtime 日志保存持久接纳、context_with_system、首个文本 delta、reply 和版本发布时间。

分别计算提交→接纳、排队→消费、消费→首文本 token、消费→持久 reply、reply→网页状态／正文；输出原始行及 p50/p95/max。跨浏览器／Node 时钟先校准并说明误差。首文本 token 不冒称内部推理开始，模型总耗时不归咎于桥接。

若进行直接 Pi 对照，用同模型／设置、独立新输入，记录上下文长度与负载差异；不以本轮组件用时宣称与直接聊天同速。10 分钟内不能完成的项目标记 NOT RUN／未完成，停止服务，不自动延期或另开端口。

原生完整网页表单回归、正式评论圆球 UI、生产 CLI 生命周期和 M1–M3 仍不在本窗口放行范围内。
