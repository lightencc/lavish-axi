# Final product verification harness

Prepared only. Do not launch until the main agent confirms the final build. These scripts load **`dist/pi-extension.mjs`**, never a prototype server. Preparing or syntax-checking them does not start Pi.

Scope: real Pi RPC, the real production HTTP server and WebSocket, durable production stores, and genuine input/reply receipts. The wrapper adds trace recording and explicit crash injection; it does not manufacture consumption, replies, or retry outcomes. Native selection/form/pin UI verification belongs to the separate browser run.

## Start and retain identity

From the repository root, after final-build approval:

```sh
node verification/polish-final-product/run.js --warmup
```

Wait for the JSON line containing `ready:true`. It names the new artifact, review URL, exact Pi PID, run directory and launch directory. Each run has independent `sessions/` and `polish-state/`. No previous verification directory or unknown Pi session is scanned/adopted. The supervisor stops its own child after 45 minutes; keep the supervising tool session tracked.

`--warmup` is an explicit **real** initialization conversation in a new isolated fixture: Pi replies READY and persists its own session before the harness opens an artifact. It does not write or forge Pi session records. Pi otherwise leaves a brand-new, message-free session's allocated file path absent; the first cold crash probe demonstrated a different session being created on resume. That failed probe remains in `run-index.json`. Resume now verifies both the durable session header and the live session ID. An un-warmed new run is reserved for the negative test that production refuses to bind an undurable session; it is not a valid crash-recovery baseline.

Send one JSON command per stdin line. Never pass a PID or arbitrary endpoint. `stop` sends SIGTERM to the owned ChildProcess; `kill` sends SIGKILL to that same child only. A stage fault uses `process.kill(process.pid, "SIGKILL")` inside that Pi process, immediately after a durable trace write.

```json
{"op":"state"}
{"op":"stop"}
```

## Direct comparison and review submissions

Use a fresh quiet run for the baseline. At least 30 direct prompts are required; a failed/aborted turn fails the command and is excluded from successful samples. No tools or artifact edits are requested. Wait for completion before review measurements; the harness rejects concurrent commands during direct measurement.

```json
{"op":"direct","count":30}
{"op":"submit","id":"review-sample-01","text":"不要修改文件、不要使用工具，只回复 OK。"}
```

Repeat review submissions with distinct IDs, awaiting each reply before the next if measuring an idle comparison. Collect at least 30 review replies too. POST uses the real same-origin endpoint; replies are observed via the real WS review snapshots. An HTTP response is never treated as proof of agent consumption. Review measurements include the production feedback envelope, so they are not a pure model-speed comparison.

The full request is saved **before** POST. Unknown transport outcomes are never automatically resent. Explicit exact replay is available only for IDs recorded in this run:

```json
{ "op": "retry-submit", "id": "review-sample-01" }
```

## Short disconnect and busy concurrency

While a submitted request is processing, issue:

```json
{ "op": "disconnect", "ms": 1500 }
```

This calls `terminate()` on the actual test WebSocket, waits for its close, then opens a new connection after 1.5 seconds and reads the authoritative snapshot. It does not merely pause a handler, fake a disconnected flag, block the operating-system network, or affect a user's browser. This scenario verifies WS transport recovery; it does **not** claim that an in-flight HTTP POST or Pi-provider transport was interrupted. No message is resubmitted during reconnection.

```json
{ "op": "busy", "count": 3 }
```

The harness starts a direct real Pi workload, observes `agent_start`, verifies `get_state.isStreaming`, then concurrently posts three session-scoped messages. Correlate IDs/attempts in the traces to verify all inputs and replies are isolated and no accepted feedback disappears. Model work is real, so duration is not assumed.

## Durable-boundary crash and exact session resume

Use a fresh run for each independent fault. Arm one stage before submitting a known ID:

```json
{"op":"arm-fault","stage":"accepted_durable","match":{"id":"crash-input-01"}}
{"op":"submit","id":"crash-input-01","text":"不要修改文件、不要使用工具，只回复 OK。"}
```

Stages supported by the fault config:

`accepted_durable`, `dispatch_reserved`, `host_admitted`, `host_dispatching`, `input_consumed`, `model_start`, `first_token`, `host_reply_persisted`, `reply_persisted`, `end_sealed`.

An optional `occurrence` selects the nth matching stage. `match` compares exact raw metadata/claim identity fields. For end faults, omit `match` or use the exact request ID from `manifest.json`. Never infer an attempt from a different message. Inspect the raw trace to confirm the fault actually fired; lack of a fault record is a failed scenario, not a pass.

Resume **only the returned run directory**:

```sh
node verification/polish-final-product/run.js --resume /absolute/path/to/this/run
```

This uses the manifest's exact session file and same product state, with a fresh launch directory/clock. It refuses another directory and refuses recovery while the previous recorded child PID is alive. It never sends a kill to that PID to make recovery possible. Crash plans are not copied to the resumed launch, avoiding repeated crash loops. `--fault /absolute/config.json` explicitly arms a new launch before extension startup when testing recovery itself.

The fixture self-kill is synchronous: trace JSONL is fsynced before the kill. Verify the resulting real state, Pi session entries and precise query/receipt recovery. An uncertain host dispatch may legitimately remain unknown; do not call it consumed or resend it automatically. `--reopen` is separate explicit authorization for an **ended** review; ordinary recovery does not reopen it.

Capture durable evidence after the crash and after recovery, then run the scenario assertions:

```sh
node verification/polish-final-product/capture.js /absolute/run before-resume
node verification/polish-final-product/run.js --resume /absolute/run
# After the expected reply or executionUnknown state is visible:
node verification/polish-final-product/capture.js /absolute/run after-resume
node verification/polish-final-product/audit-recovery.js /absolute/run accepted_durable crash-input-01
```

Captures use exclusive files and include the actual review ledger, host ledger, exact Pi input/assistant entries, and source-file SHA256 values. Audit always writes a structured pass/fail result. It checks same session and endpoint, the exact fault witness, one durable logical message and one Pi input, and the scenario's reply/unknown/end invariant. An ended review is read directly on resume; it is not opened again implicitly. These assertions are independent of whether the runner itself exited normally.

## End failures

```json
{"op":"arm-fault","stage":"end_sealed"}
{"op":"end","text":"Final feedback: no file changes; acknowledge only."}
```

The request, final ID and epoch are persisted in the manifest before POST. After exact-session recovery:

```json
{"op":"state"}
{"op":"retry-end"}
```

Retry uses the original sealed request. A second `end` for that epoch is refused, preventing a new ID from hiding an unknown result. Check one final input and one marker, ending until actual marker consumption, then ended. To test execution abort, issue `abort` while real Pi processing is underway and inspect the failed proof instead of assuming completion. The script's `end` is manual whole-page ending; browser confirm with artifact digest/load token is a separate UI scenario.

## Evidence and clocks

Every launch records:

- `client.jsonl`: supervisor RPC/HTTP/WS observations and commands, tagged with its unique `clockID` and `performance.timeOrigin + performance.now()`.
- `trace.jsonl`: trusted source stages and raw identity metadata, tagged with the Pi process's distinct clock and PID.
- `instrumentation.jsonl`: measured synchronous primary trace encode/write/fsync duration per stage. It excludes its own secondary bookkeeping write and fault-config read; this limitation is preserved in the report.
- `ready.json`: exact session/endpoint/PID identity; `fault.json` only when explicitly armed.

`model_start` means Pi's `before_provider_request` hook, **not** actual provider processing start. `first_token` means first visible `text_delta`; stage metadata does not include token content. `input_consumed` is recorded after the host input proof is durable and before its receipt is delivered. Host reply durability and review-store reply durability are separate stages.

Do not directly subtract timestamps from different `clockID`s, even though each carries an epoch-shaped value. Supervisor direct/HTTP/WS comparisons use the supervisor clock; source-stage differences use the same Pi clock and exact message/epoch/attempt. Cross-restart stages cannot produce a same-clock duration.

Before G07 timing, calibrate while idle:

```json
{ "op": "calibrate", "count": 10 }
```

The test wrapper registers `/polish-verify-clock <nonce>` as a local extension command. It returns its clock ID and `performance.timeOrigin + performance.now()` through `ctx.ui.notify`; it never sends a model prompt. The supervisor records send/receive bounds for every RPC round trip. At least 10 raw samples are saved in `client.jsonl` and an independent `source-calibration-<uuid>.json`; the minimum-RTT sample supplies the narrowest individual interval. If source time is H and supervisor bounds are S/R, source-minus-supervisor offset lies in **[H−R, H−S]**. Midpoint is an estimate, half RTT its uncertainty bound; no symmetric-delay assumption is claimed.

For a source timestamp H, the mapped supervisor interval is `[H−offsetUpper, H−offsetLower]`. The browser agent must independently calibrate its own clock to this supervisor and retain its raw samples; the supervisor provides `{"op":"clock"}` without model work. Compose intervals and carry both uncertainties when reporting source-to-browser duration. Do not use a raw browser-minus-source subtraction. Recalibrate each new launch/clock and around long measurements; an earlier estimate does not remove subsequent clock drift. The offline summary reports calibration separately and does not silently apply midpoint corrections.

For the browser agent's explicitly supplied, dedicated CDP page target, calibrate before and after its UI sample batch:

```json
{ "op": "browser-calibrate", "websocket": "ws://127.0.0.1:PORT/devtools/page/DEDICATED_TARGET_ID", "count": 10 }
```

The supervisor only evaluates browser clock readings. It records `browser:<targetId>:<timeOrigin>`, absolute browser readings plus `timeOrigin`, supervisor bounds and the minimum-RTT interval in independently named files. UI samples that use relative `performance.now()` add the recorded browser `timeOrigin` before applying the bounded conversion. No production clock route or UI mutation is added.

Offline summary, without starting Pi:

```sh
node verification/polish-final-product/summarize.js /absolute/path/to/this/run
```

This creates `summary.json` with counts, p50/p95, instrumentation costs and explicit sample sufficiency. Each direct attempt is logged before its prompt; explicit failures and started-but-unfinished attempts remain listed, and each batch reports not-started samples. A first-sample failure cannot disappear behind an empty successful set. Ambiguous repeated stage pairs or differing attempts are excluded rather than merged. The fsync instrumentation is intrusive: report its measured cost alongside latency and never silently subtract it. Raw traces remain authoritative; a summary alone does not prove ordering, correctness, duplicates or recovery.

No scripts or evidence in older verification directories are modified. No unknown prototype listener or prior message is touched.

## Busy work, socket interruption and end race

Use a new durable run, issue `{"op":"busy","count":3}`, then run
`node verification/polish-final-product/race-check.js /absolute/run` while feedback is queued.
Issue `{"op":"disconnect","ms":1500}` on the supervisor to terminate and recreate its real WS connection. The race verifier records actual GET/POST poll takeover rejection, concurrently submits a prompt and end request, and checks fixed end membership, idempotent end retry, changed-final conflict, and one real Pi input per accepted ID.

`--continue` audits the previously recorded end after the observed HTTP 500 `CLOSED` regression; it never sends the race prompt again. Its separate `race-continuation.json` can prove fixed-set and duplicate safety, but **does not turn the original HTTP classification failure into a pass**. The original `race-evidence.json` remains unchanged. Final HTTP behavior requires a fresh isolated run after the fix.
