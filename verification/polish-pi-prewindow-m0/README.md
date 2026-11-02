# Pi M0 pre-window r3

这是 r2 之后的开窗前修复／最小接入。r2 代码、报告和证据不修改。r3 `page.js` 为当前客户端修复版；r3 `serve-prepared.js` 只导出启动函数，未被调用。

- `client.test.js` 在 VM 执行真实 page.js，DOM／fetch／EventSource 为明确边界替身。
- 生产 `createPollHandler` 与 `SessionStore.takeFeedback` 共用新增的反馈账本；runtime.js 同时接桥接和该处理器。
- `window.js` 与 window.test.js 覆盖启动、占用、截止、晚到 bind、退出及幂等清理。真实 Node 子进程退出单列；Server 替身不等于实际 TCP。
- `web.test.js` 覆盖 SSE cancel／abort、快照和请求校验；peer.test.js 覆盖实际 spawn 失败时 close 事件清理。
- `probe.js` 只通过管道启动专用 Pi，不绑定端口；已完成的原始 run 与最终 run 分别保存在 pi-poll-* 和 pi-poll-final-*。不要重跑覆盖证据或复投历史 unknown。
- `no-listen-guard.js` 是测试进程的禁止监听检查；任何真实 Server.listen 都直接报错，不是假装网络已通过。

审查契约见 CONTRACT.md；下一轮唯一服务的精确计划见 BROWSER-PLAN.md。没有监听许可，不能执行 startPreview()。

可安全重跑的非监听测试命令（在仓库根目录；父进程与子进程均使用绝对 guard 路径）：

```sh
NODE_OPTIONS='--import /Users/lightencc/Documents/Projects/polish-axi/verification/polish-pi-prewindow-m0/no-listen-guard.js' node --test test/session-store.test.js test/feedback-delivery.test.js test/poll-delivery.test.js test/poll-delivery-output.test.js verification/polish-pi-prewindow-m0/client.test.js verification/polish-pi-prewindow-m0/web.test.js verification/polish-pi-prewindow-m0/window.test.js verification/polish-pi-prewindow-m0/peer.test.js
```

完整测试套件含真实监听用例，本轮没有运行，不把部分回归称为完整 check。构建、typecheck、相关 lint／format 分别记录证据。产品仍为 v1.2，M0 未整体放行。
