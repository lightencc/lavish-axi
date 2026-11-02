# Pi M0 开窗前最小接入 r3

产品契约仍为 v1.2，Pi 优先。r2 目录为只读历史版本，r3 为当前修复／验证版本。此前 169 条 manifest 条目保持原样；不修改 49791／49792 的原型、配置或进程。

## 已授权的边界

本轮按父任务的开窗前安排修改本地生产源码，只提取真实 poll 处理器和接入必要的共享账本。不是 M1–M3 放行，不新增 TCP 监听，不改安装版 Pi，不新增凭据或安全配置，不上传、不提交、不推送、不部署。不重投历史未知消息。

## 消费裁决

`SessionStore.bindFeedback` 仅为内部、显式绑定新 artifact 会话的入口，默认不启用。绑定后桥接和真实 `createPollHandler → takeFeedback` 共用 state.json 的 `review_delivery`；使用同一 store.lock。模式与 generation 先核对，claim 与 pending 移除在同一原子写中保存。一次取一个消息，唯一未决投递阻止下一次 claim。未绑定会话保留原批次、回执和断开 restore 行为。

host reservation 在调用 Pi 前持久化。同一 poll 响应／token 重复提交不能再次调用宿主。poll JSON 写出、HTTP 200、host admission 都不能标记 consumed。可信宿主适配器以 binding／epoch／id／digest／attempt 和 context_with_system 证据确认输入；浏览器没有 claim、mode、recover 或 reconcile 接口。

丢响应、断开或恢复后的未决 claim 保持 unknown；不恢复 accepted，不盲重发。`recoverFeedback` 仅用于已建立单一服务器所有权后的内部交接，递增代次并保留原 attempt。它不提供跨进程锁、PID-only 接管或额外高可用能力。当前 r3 预览每次使用全新隔离 state 文件；不接管别的服务状态。

已消费但 reply unknown 与 delivery unknown 分开。固定已有集合、final、marker 全部真实消费后 ended；无需等待回答。晚到传输错误不能覆盖已验证回复。无关联 legacy reply/end 及 bound reopen 明确拒绝，避免旧接口绕过新生命周期；M0 结束入口使用 /end。完整正式用户界面与全功能迁移仍属后续阶段。

## 客户端与启动

r3/page.js 执行状态去重后仍补齐缺失的回复缓存；同版本快照可以重试只读 query，旧版本不能回退状态，不重投用户消息。r2/page.js 保留旧缺陷作为历史原件，供 RED 和哈希审查；准备启动器只提供 r3 资源。

启动阶段先专用 Pi ready、记录 PID／instance／session，再建共享 review runtime，最后才允许唯一固定 bind。端口占用不重试、不换端口，只清理自有资源。截止为 bind 成功后 600000 ms；关闭 listener／SSE socket，再关闭 review，最后退出自有 Pi。子进程退出、ready 失败、bind 中退出均不能留下活窗口。

本轮所有网络边界均未开放。测试中的 HTTP req/res、Server 和 timers 替身明确标注；真实 handler／store、客户端 page.js、Node 子进程和 Pi 组件分别单独取证。测试 tripwire 会拒绝任何真实 net.Server.listen，并非用假网络伪装端到端通过。下一轮精确范围见 BROWSER-PLAN.md，仍需新的监听许可。
