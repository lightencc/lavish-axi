# Pi M0 combined r2

隔离机制与证据，非产品实现。产品要求仍为 `docs/polish-development-spec.md` v1.2。结论见 [组合报告](../../docs/polish-pi-combined-m0-report.md)，历史语义修正见 [勘误](../../docs/polish-pi-recovery-m0-errata.md)。

- `host.js`／`host-extension.js`：精确身份的 Pi 持久 inbox，输入 witness、正向查询。
- `coordinator-child.js`／`coordinator-peer.js`：独立可重启写者；复用只读的 r1.1 Authority 和 drain。
- `peer.js`：自有 Pi RPC 管道，显式隔离扩展，不监听。
- `probe.js`：真实 Pi 组合实验，已执行一次并保存结果。不要重跑来覆盖证据；日志以 wx 创建，重复执行拒绝覆盖。不得重投历史 unknown。
- `web.js`／`index.html`／`page.js`：只准备的会话级网页与接口，无元素锚点。
- `serve-prepared.js`：只导出 startPreview，不自动启动；调用会启动 Pi 和最多 10 分钟的单一 49793 监听，须新的明确授权。参见 [网页计划](BROWSER-PLAN.md)。
- `evidence/`：原始业务事件、版本哈希、测试日志、前后证据检查；不存模型思考或凭据。
- `runtime/`：git 忽略；含自有测试 session 和持久账本。保留故障事实，不清理重放。

安全的非监听单测命令：

```sh
node --test verification/polish-pi-combined-m0/host.test.js verification/polish-pi-combined-m0/coordinator.test.js verification/polish-pi-combined-m0/web.test.js
```

真实 poll 集成、浏览器和新性能样本均未验收。完整 Pi M0 未通过。
