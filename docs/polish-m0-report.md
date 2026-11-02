# Polish M0 受控通信验证报告

日期：2026-10-30（Asia/Shanghai）。结论：**M0 未通过，停在此关卡，不能进入 M1–M3。**

依据：[正式开发书 v1.1](polish-development-spec.md)，核定 SHA-256 `a378fe3b29818ceb1a691d68f45561f304bcb29aa0ebb77045610deb9069df77`。本轮未改动该开发书或生产代码。验证只使用当前 Codex 的只读身份检查、隔离 Pi RPC 子进程、无工具的标记消息和项目内证据文件。

关键结果：Pi 原生 RPC 可以在持续运行的同一测试 session 中自动处理空闲／后续输入、忙碌时排队；但相同 RPC 请求 ID 被重复执行，排队回执也不代表崩溃后可恢复。当前 Codex 桌面实例尚无已核实可供本地网页服务使用的接入端点。不能把这些实验扩大解释为已完成网页绑定、可靠桥接或正式实时同步。

## 1. 版本、身份与实验边界

| 对象 | 实际版本／身份 | 边界与证据 |
| --- | --- | --- |
| 核定开发书 | v1.1，哈希同上 | 未修改 |
| Codex CLI | 0.165.0 | `/Users/lightencc/.local/bin/codex` |
| Codex 桌面宿主 | 0.166.0-alpha.5.1；本次观察 PID 36272 | 当前命令为 app-server，未指定 `--listen`；观察到 stdio 通道。未启用远程控制或启动另一 daemon |
| 当前 Codex 会话 | `01a18c17-e9a9-7d03-b0dd-be4bf21f18ad`；host `local` | 环境变量与桌面 `read_thread` 对应，同一项目路径；本轮 turn `01a18c50-efd5-7510-aef5-8084c32762c2` |
| Pi | 1.4.0 | 安装包 `@earendil-works/pi-coding-agent`；直接读取该版本文档和实现 |
| Pi 正常／重复／延迟实验 | PID 69399；session `01a18c53-f2e2-7504-9859-9fc05b8b33a4`；名称 `POLISH-M0-ISOLATED-20261030` | 18:21:14 启动，18:28:38 正常关闭；所有 36 次提交在此同一进程／session 内完成 |
| Pi 崩溃实验 | 原 PID 30386，恢复 PID 30521；session `01a18c5c-800c-74ae-acf8-d88fc3666d70` | 独立名称 `POLISH-M0-CRASH-20261030`；18:30:34–18:30:37。恢复仅查询，未发送新 prompt，不算原活动实例的绑定证明 |
| Pi 配置 | 当前默认 `magpie` / `grok/grok-4.7`，thinking `medium` | 没有切换模型；工具、MCP、扩展、项目上下文均禁用，使用隔离工作与会话目录。没有改动宿主全局配置或其他 Pi 进程 |

未找到本项目已运行的 Pi 会话；检测到的 Pi 进程位于其他项目，未投递、停止或接管它们。隔离 Pi 是显式新建的验证实例，不是把用户已有会话历史重放到另一进程，也不冒充已经接入用户现有交互式 Pi。所有请求经子进程 stdin/stdout RPC；本轮未启动网页桥接服务或占用原型端口。

版本和 Codex 连接检查见 [environment.json](../verification/polish-m0/evidence/environment.json)，当前桌面身份见 [codex-thread-identity.json](../verification/polish-m0/evidence/codex-thread-identity.json)。安装版协议来源及哈希见 [pi-source-manifest.json](../verification/polish-m0/evidence/pi-source-manifest.json)。

## 2. G01–G07 逐宿主结果

PASS 只表示该行所述已执行范围通过；BLOCKED 表示无法建立必要前提；FAIL 表示观察到不满足契约的行为；NOT RUN 表示该实验没有执行。部分证据不能替代完整门槛。

| 门槛 | Codex | Pi | 证据与限制 |
| --- | --- | --- | --- |
| G01 同一活动 session | **BLOCKED** | **BLOCKED** | Codex 当前身份已核对，但本地服务端点未建立。Pi 隔离实例的同一 PID／session 身份核对通过；用户已有 Pi 会话接入及网页绑定未验证，故完整 G01 不记 PASS |
| G02 自动处理 | **BLOCKED** | **PASS（隔离 RPC 范围）** | Pi 空闲及上一轮结束后自动执行；`pi-busy-followup-004` 在前一轮处理中得到 queued，前一轮正常完成后才消费，无 abort／steer。不是网页端到端证明 |
| G03 三级回执 | **NOT RUN** | **BLOCKED** | Pi 日志区分本地记录、started／queued 响应和 user message_start。真实消息与回复可人工核验，但消费事件不携带原 RPC id，测试标记匹配不是正式可信关联协议；未建立满足 v1.1 的身份链 |
| G04 未知结果与幂等 | **NOT RUN** | **FAIL** | 同 id／同载荷实际执行两次。丢排队回执的受控实验保留未知、不重投；未证明原生 RPC 提供可查询的持久幂等键或安全排除已执行的查证能力 |
| G05 恢复与唯一消费 | **NOT RUN** | **FAIL** | 崩溃前 queued，恢复同一测试会话后 pending=0 且该消息不在持久记录中；无安全自动恢复证明。桥接与遗留 poll 的并发唯一消费实验未运行，不能由单一 RPC 写入者推导通过 |
| G06 结束排空与重连同步 | **NOT RUN** | **NOT RUN** | 当前无实现 v1.1 的最小桥接／状态流，未执行 ending 排空和版本快照交界实验。关闭测试子进程不算 Polish ended；未用模拟状态机代替宿主验收 |
| G07 延迟与失败 | **NOT RUN** | **NOT RUN（完整门槛）；30 次 RPC 采样已完成** | Pi 原始采样及故障样本已保存；网页反馈、模型开始时刻、完整实时通知、直接聊天对照未测，不能宣称完整性能门槛通过 |

Codex 未发出任何验证 prompt，不存在其投递结果未知的消息。阻塞不等于 Codex 产品没有这些能力，只说明本环境尚未建立符合约束、可从本地服务使用且绑定当前实例的路径。

## 3. Codex 接入阻塞证据

只读执行 `codex app-server daemon version` 返回退出码 1：无法连接 `/Users/lightencc/.codex/app-server-control/app-server-control.sock`，原因是路径不存在。未执行 `daemon start`、`enable-remote-control`、bootstrap、凭据生成或 `codex queue` 投递，避免默认 daemon 与当前桌面实例身份混淆。

从正在使用的桌面二进制生成了本地协议 schema：`TurnStartParams` 有 `clientUserMessageId`，但该字段没有声明持久幂等语义，不能凭字段名称推断去重；schema 存在也不能证明可连到当前实例。摘录见 [codex-capability.json](../verification/polish-m0/evidence/codex-capability.json)。

桌面连接器的 `read_thread` 可证明当前身份；其工具调用能力不等于项目内 Node 服务拥有同一调用通道。没有通过复制凭据、操作内部 stdio、打开新监听端点或向别的聊天发消息来填补这个缺口。

停止的准确步骤：从本地 Polish 验证服务向当前桌面 thread 投递。目标是上表当前 thread，原因是缺少已验证的实例接入端点及消息交付／查询语义；该步骤未发送消息，结果不属于 delivery_unknown。后续需先确定受支持的当前宿主入口，不能自行扩大权限。

## 4. Pi 正常路径、重复请求与崩溃

### 4.1 正常路径

正常序列原始事件见 [pi-events.jsonl](../verification/polish-m0/evidence/pi-events.jsonl)，序列包括：

1. `m0-state-before` 取得空闲 session 身份。
2. `pi-idle-001` 得到 started；独立的 user message_start 和真实 assistant 回复随后出现。
3. 第一轮 agent_settled 后发送 `pi-busy-002`，再次自动执行。此消息名称虽含 busy，实际状态是空闲，**没有把这次误记为忙碌样本**。
4. `pi-busy-anchor-003` 与 `pi-busy-followup-004` 连续投递；后者得到 queued，状态查询 isStreaming=true、pendingMessageCount=1。前者 assistant 回复结束后，后者才进入 user message_start 并得到自己的回复。
5. 随后的 30 个 `pi-latency-*` 样本均在相同 PID／session 连续处理，最终状态 idle、pending=0，进程正常退出。

本地记录通过 fsync 后才写宿主 stdin；日志的 local_persisted 时间戳在 fsync 前取得，所以只可用到 stdin_written 的间隔界定持久化耗时上界，不能冒充精确的浏览器提交回执时间。started 和 queued 都仅分类为 host_acceptance；消费证据来自后续输入事件和持久记录，而非 response success。

### 4.2 重复请求故障

同一个 `m0-pi-duplicate-005` RPC id 和完全相同载荷，在第一条真实回复已完成后受控再发一次；目的为故障注入，不是未知结果下的盲重试。两次分别得到 started、用户输入事件、不同 assistant responseId，及以下不同持久化用户条目：

- `66bf8cf0`，18:22:57.096。
- `4573e930`，18:23:08.725。

见 [duplicate-evidence.json](../verification/polish-m0/evidence/duplicate-evidence.json) 与 [pi-persisted-user-entries.json](../verification/polish-m0/evidence/pi-persisted-user-entries.json)。安装版 `rpc-mode.js` 只把 `command.id`用于回应，调用 `session.prompt()` 时没有传入该 id；与实际重复执行一致。这个结论只针对原生 RPC 路径，不宣称 Pi 不能通过受支持扩展补充机制。

### 4.3 丢回执与崩溃恢复

在独立崩溃实例完成 warmup 后，发送 `fault-active`，紧接着发送 `fault-queued`。监督记录器看到了 queued 回执，故意不把它交给模拟桥接消费者；消费者记录 `delivery_unknown`、retry_count=0。随后只 SIGKILL 本实验直接创建并持有的 Pi 子进程。

恢复进程以同一测试 session 文件启动，只执行 get_state，没有重投 prompt。结果 session ID 相同，pendingMessageCount=0，持久化用户记录包含 warmup 和 active，不含 queued。证据见 [pi-crash-events.jsonl](../verification/polish-m0/evidence/pi-crash-events.jsonl:13)。

| 消息 | 崩溃前证据 | 恢复后处理与未决状态 |
| --- | --- | --- |
| fault-active | started + user input 事件，尚无 assistant 完成记录 | 未重投；输入已观察，执行／回复结果未知。不能把进程被杀当作远端推理已取消 |
| fault-queued | 监督者见 queued，消费者故意收不到；无消费回执 | 未重投；消费者保留 delivery_unknown。恢复时队列和持久记录未找到它，不据此宣称从未执行或可以安全重发 |

这是**真实 Pi 进程崩溃 + 测试监督者模拟丢回执**，不是真实网络丢包，也不是正式桥接账本实现。这里持久化的 unknown 是证据记录，未实现生产恢复服务。安全停止、不重投的策略得到展示，但自动恢复、权威查证与唯一消费仍未通过。

## 5. 分阶段延迟与全部样本

30 次普通往返全部完成，无显式运行错误；使用同一默认模型、同一 Pi session，P50／P95 为 nearest-rank。总计第一组 36 次提交（含一次受控重复），第二组 3 次提交（warmup、在途、排队）：39 次均保留，不从报告剔除故障样本。第二组的两个未完成请求不进入“正常空闲往返”分布，单列为上节未决结果；这不等于整体零失败。

以下均为本地记录起点到观察事件的累计毫秒，包含日志 fsync 的观测开销；不是浏览器交互指标，也不是纯模型耗时。

| 累计观测指标 | 样本数 | P50 ms | P95 ms | 最大 ms |
| --- | --- | --- | --- | --- |
| 完成持久记录并写出 stdin | 30 | 5.542 | 8.628 | 14.518 |
| 宿主 started 接纳响应 | 30 | 10.196 | 16.170 | 20.005 |
| 真实 user 输入事件 | 30 | 22.392 | 29.192 | 32.694 |
| assistant 流开始事件 | 30 | 1166.793 | 2103.169 | 3024.383 |
| 首个文本 delta | 30 | 1184.590 | 2120.377 | 3278.746 |
| 完整回复事件 | 30 | 1231.311 | 3258.295 | 3324.565 |

原始样本、逐项证据行号、busy 样本与重复样本均见 [pi-latency.json](../verification/polish-m0/evidence/pi-latency.json)。`assistant_start_observed` 只代表可见流事件，不等于内部模型实际开始推理；首个文本 delta 也不等于未暴露的 reasoning token。单独 busy 样本的排队等待不混入空闲 P95。

尚未取得：网页点击到持久化回执、接收事件到橙色显示、回复落库到网页通知、Codex 对照、Pi 交互式直接聊天对照，以及内部模型开始时刻。因此没有给出这些指标的虚构数值，也没有以 RPC 数据判定完整 G07 达标。

## 6. 验证文件、复核与清理

本轮新增内容仅在 `verification/polish-m0/` 和本报告。未改动原型端口、原型进程、生产 src、README 或全局宿主设置。未生成持久凭据、上传附件、作出付费承诺、提交、推送或部署。测试消息由现有默认模型提供实际回复，记录了运行用量；没有购买或开通服务。

- [pi-probe.js](../verification/polish-m0/pi-probe.js)：正常、busy、重复和延迟实验的持久 RPC 记录器；不会自动重试。
- [pi-crash-probe.js](../verification/polish-m0/pi-crash-probe.js)：仅终止自己创建的子进程；缺省拒绝覆盖已有故障证据。
- [probe.test.js](../verification/polish-m0/probe.test.js)：JSONL 边界、acceptance 与消费区别、未知与拒收区别，3 项通过。先保存了模块缺失的 RED，再有 GREEN；**这些是记录器测试，不是生产可靠性测试**。
- [analyze.py](../verification/polish-m0/analyze.py)：只分析已保存日志，可重算延迟，不发送消息。
- [cleanup.json](../verification/polish-m0/evidence/cleanup.json)：所有本轮创建的 Pi／记录器进程均已退出。原采样会话无 pending；崩溃实验的未决记录保留，不执行后台重试。
- `runtime/`：本地隔离会话、生成的宿主 schema，已在本验证目录内忽略；不作为发布内容。可复核的摘录、原始事件与哈希在 evidence 中保留。

只读复核命令：

```sh
node --test verification/polish-m0/probe.test.js
python3 verification/polish-m0/analyze.py
shasum -a 256 docs/polish-development-spec.md
```

已完成新增 JS 语法检查、3 项记录器测试、日志结构／身份／样本完整性检查及文档链接检查。本轮没有运行生产 `pnpm run check`，因为未修改生产实现，也未把这些实验当作正式交付。不要为复核直接重跑宿主实验脚本；它们会发起真实模型请求，其中故障脚本会终止自己的测试进程。

## 7. 关卡处置

当前结论是 **NO-GO**，供独立验证方审查。优先待解决的是：当前 Codex 活动实例的受支持接入方式；Pi 侧稳定外部消息身份、权威回执／查证或持久幂等；崩溃后队列恢复与唯一消费。之后才有条件验证真实 ending 排空和无缺口重连，并补齐网页性能与直接聊天对照。

这些是下一次 M0 的前置问题，不是 M1–M3 开发放行。若所需接入必须新增权限、凭据或调整平台配置，应明确报告具体动作和目标再处理，不能为了通过关卡绕过约束。本轮停止于此，没有继续正式开发。
