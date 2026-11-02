# Pi M0 非监听组合契约 r2

产品契约仍为 v1.2。只改本隔离目录及新增报告／勘误；不改生产源码、旧证据、原型或已安装 Pi。使用新 UUID 消息，禁止重投任何历史 unknown。

## 组合边界

- supervisor 启动专用 Pi 并一直持有其 RPC 管道。可重启的 coordinator 子进程只拥有桥接 Authority。恢复必须由 supervisor 持有真实已退出 ChildProcess 和锁 nonce；短暂恢复 Authority、clean close 后再交给新 coordinator。此交接不是任意孤儿恢复协议。
- 绑定 artifact、Pi instance、Pi session 和 PID；coordinator 重启前后均查询活 Pi 核对，不能另起 Pi 代替恢复。
- 复用 r1.1 Authority／drain，不改旧代码。宿主持久 admission 是排队证明；context_with_system 才是消费证明。宿主查询必须精确匹配 binding、epoch、id、digest、attempt；不存在记录或历史为空均返回 unknown／safeToResend:false。
- accepted 尚未 dispatch 的恢复允许首次投递。宿主已接纳但回执丢失时停止投递并正向查询，恢复已有状态，不再 admit。任何不确定性都不自动退回 accepted。
- host 一次只处理一个输入。持久化 dispatch 后调用 sendMessage；出现未知不自动再调用。处理事实和回复事实单独保存，模型文本不决定身份。
- final batch 在 beginEnd 时封存；所有成员及 marker 消费后结束。marker 之前不得 ended；marker 已消费则不等回答，不关闭整个 Pi 会话。

## 实际 poll 边界

原生 `src/cli.js:pollCommand` 调用 ensureServer 和 HTTP `/api/poll`。`src/server.js:handlePoll` 闭包内维护 activePolls／pollOwnershipLock 并调用 takeFeedback，唯一导出的服务入口 serve 会实际 listen，没有导出的非监听 handler。当前隔离 Authority 与生产 store 不共享裁决。

因此本轮不运行真实 legacy poll，不调用 ensureServer，不 monkey-patch 网络库或把 IPC 假消费者叫作真实 poll。只验证本地 mode／generation 拒绝，并准备适配边界说明。真正 poll＋桥接排他仍为 NOT RUN，必须后续在受控服务中接入同一裁决后验收。

## 验证与网页准备

先 TDD 本地身份／查询与 coordinator，后真实 Pi accepted 重启、丢接纳回执查询及 final drain。记录原始业务事件、会话身份、子进程退出、状态快照、源文件哈希和旧证据完整性；不记录模型思考或凭据。

准备静态页和纯 Request handler：`/binding`、`/submit`、`/query`、`/snapshot`、同端口 SSE `/events`、`/end`。整体输入只有会话身份，不带元素锚点。先订阅再取快照；重连发送当前完整快照，客户端按 version 拒绝旧事件；完成事实存在权威快照，不能仅依赖 toast。准备 30 次分阶段性能采样。

本轮无监听入口执行。候选下一轮只用 `127.0.0.1:49793`，最多 10 分钟；Pi 预先 ready、身份记录完毕后才允许 bind。任何网页运行均待新的明确授权，旧许可不可复用。到时限关闭连接／监听，退出自有子进程并核对端口。49791／49792 不动。M0 未整体通过，不进入 M1–M3。
