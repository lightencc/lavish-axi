# Pi M0 恢复机制契约 r1.1（v1.2 范围）

本文件限定验证机制，不是产品 M1–M3。禁止任何新监听。本轮只使用本地文件、子进程管道、公开 Pi 扩展 API 和新标记的自有测试实例。

## 状态及不变量

- 绑定固定 artifact、宿主 instance/session。`reviewEpoch` 标识评审代次；`ownerGeneration` 标识消费权代次；`version` 持久单调，三者不能互相替代。
- 消息为 accepted → dispatching → host_queued → delivered → replied。host_queued 只表示接纳；只有明确输入证据才能 delivered。dispatching／host_queued 在失去权威联系后保持 unknown，永不自动回到 accepted。已见输入但未见回复保留输入事实，执行结果仍未决。
- bridge 和 poll 只能通过同一协调器 claim；只开放一个消费模式。调用前在同一原子持久写中记录 attempt、代次和 claim token。存在 dispatching／host_queued／unknown 时拒绝切换模式。过期时间不产生接管权。
- 单写者由 owner-only 的排他锁约束。崩溃接管要求 supervisor 持有自己创建的 ChildProcess、实际 exit 事件，以及旧锁中匹配 PID／随机 nonce。仅 PID 不存在、心跳超时、调用者声称“已退出”均不够。恢复仍只开放从未派发的 accepted；旧 token 的写入和调用均拒绝。恢复中再崩溃时宁可阻塞，不猜测接管已成功。
- 协调器的内部回执接口只由受信适配器调用；单测构造的事件是替身，不作为 Pi 事实。未知的解除需与原 binding、epoch、message、digest、attempt 精确对应的宿主证据。

## ending 与同步

- beginEnd 一次事务保存 end_request_id、最终消息（若有）、独立结束标记、此前全部已接受消息的固定集合，并切 ending。晚到新消息拒绝；重复 end 同载荷幂等、异载荷冲突。
- 集合按序消费，结束标记只能在之前成员全有真实输入证据后派发；最终标记也 consumed 后才 ended。不等待模型回复，不结束整个 Pi 进程。unknown 阻止排空，浏览器离线不取消队列。
- ended 后只允许正向迟到证据归档，不能唤醒或回退。reopen 仅在 ended，开启新 reviewEpoch，持久 version 继续增长；旧 epoch 不能写新状态。
- 每次持久变更生成同 version 的快照事件。单写协调器以原子文件保存事实、version 和有界事件历史。订阅先注册，再取一致快照；读取间发生的事件缓存。客户端按连接代次、version、epoch 合并；重复丢弃、乱序缓存、缺口重新同步、旧连接拒绝，epoch 改变先取新快照。此阶段使用内存订阅／管道，无 WebSocket／网页验收。

## 回复窗口与能力边界

Pi `turn_end` 提供已持久回复的 entry ID。候选扩展把原消息身份和该 ID 写成宿主 custom receipt，再核对宿主磁盘记录；sidecar 只能从此结构化 receipt 恢复关联。用两个新隔离实例分别故障注入：

1. 宿主回复及 receipt 已存、sidecar 未写：从 receipt 正向恢复。
2. 宿主回复已存、receipt 尚未写：保持 unknown，不按相邻记录或相似正文推断。公开 API 没有把回复及 receipt 合为原子事务，这个窗口不能声称已解决。

Pi 原始历史的正常 append 不直接等于断电保证；本轮只验证指定进程崩溃窗口。恢复历史查询不是绑定原活动实例。不得恢复或重投任何历史未知消息。

## 验证顺序

1. TDD：身份／代次、同一消费裁决、unknown 安全停止、结束并发／固定集合、旧 token 拒绝。
2. 无监听故障子进程：accepted 落盘后退出与接管；dispatch 后退出仍 unknown；bridge／poll 竞争共享裁决。
3. 无监听同步测试：订阅／快照交界、乱序／重复／缺号、旧连接／旧 epoch、结束事件和持久重启。
4. 真实 Pi：公开扩展生成／缺失 receipt 的两种回复窗口；单次新实例各一条新消息，无其他工具或会话。
5. 输出分层证据及仍未满足门槛。下一次网页验证必须另获监听许可，本轮不启动。

r1.1 收紧了模式切换的代次隔离、结束请求字段顺序无关的幂等，以及“没有实际 dispatch attempt 的回执不得消费 accepted 消息”。真实 Pi 两次实验运行在最后一项守卫收紧之前；实验中的两个回执均携带已持久的合法 attempt。最后一项由新增 RED→GREEN 测试核验，没有为此重复模型请求。精确最终代码哈希见 evidence/code-version.json。
