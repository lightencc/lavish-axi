import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { appendFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

// This script is opt-in: preparing/building it never starts Pi. No historical run is adopted.
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, "../..");
const args = process.argv.slice(2);
const value = (name) => {
  const at = args.indexOf(name);
  if (at < 0) return null;
  if (!args[at + 1] || args[at + 1].startsWith("--")) throw new Error(`Missing ${name} value`);
  return args[at + 1];
};
const resume = value("--resume");
const run = resume ? realpathSync(resume) : path.join(root, "runtime", randomUUID());
mkdirSync(path.join(root, "runtime"), { recursive: true });
if (resume && !run.startsWith(realpathSync(path.join(root, "runtime")) + path.sep))
  throw new Error("Resume must name this harness's own run directory");
mkdirSync(run, { recursive: true, mode: 0o700 });
const manifestFile = path.join(run, "manifest.json");
const manifest = resume
  ? JSON.parse(readFileSync(manifestFile, "utf8"))
  : {
      schema: "polish-final-product-v1",
      runID: path.basename(run),
      run,
      artifact: path.join(run, "artifact.html"),
    };
assert.equal(manifest.schema, "polish-final-product-v1");
assert.equal(manifest.run, run);
if (resume) {
  assert.ok(manifest.sessionFile?.startsWith(path.join(run, "sessions") + path.sep));
  const header = JSON.parse(readFileSync(manifest.sessionFile, "utf8").split("\n")[0]);
  assert.equal(header.id, manifest.session, "Resume requires the exact durable Pi session header");
  if (manifest.livePid) {
    let alive = true;
    try {
      process.kill(manifest.livePid, 0);
    } catch (error) {
      if (error.code === "ESRCH") alive = false;
      else throw error;
    }
    assert.equal(alive, false, "Previous owned Pi is still alive; use its supervisor to stop it first");
  }
} else {
  writeFileSync(
    manifest.artifact,
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Polish final verification</title><style>body{background:#f5f6f8;color:#1f2329;font:16px/1.8 system-ui}main{max-width:800px;margin:40px auto;padding:32px;background:white;border:1px solid #dee0e3;border-radius:10px}section{padding:16px;border:1px solid #dee0e3;margin:20px 0}button{background:#3370ff;color:white}</style><main><h1 id="title">Polish 正式验收</h1><section id="summary"><h2 id="heading">可修订的标题</h2><p id="alpha">第一段用于文字选区。</p><p id="beta">第二段用于跨段选区。</p></section><form data-lavish-question="final-form"><label><input type="radio" name="verdict" value="yes">符合预期</label><label><input type="checkbox" name="selection" value="text">文字选区</label><input name="note"><button>提交表单</button></form></main><script>document.querySelector("form").onsubmit=e=>{e.preventDefault();window.lavish.queuePrompt("表单反馈："+JSON.stringify(Object.fromEntries(new FormData(e.target))),{scope:"session"});window.lavish.sendQueuedPrompts()};</script></html>',
  );
}
const previousLaunch = manifest.launch;
const launch = path.join(run, "launches", randomUUID());
mkdirSync(launch, { recursive: true, mode: 0o700 });
const clockID = `supervisor:${process.pid}:${randomUUID()}`;
const now = () => performance.timeOrigin + performance.now();
const log = (stage, metadata = {}) =>
  appendFileSync(
    path.join(launch, "client.jsonl"),
    JSON.stringify({ stage, metadata, clockID, at: now(), pid: process.pid }) + "\n",
  );
const save = () => writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), { mode: 0o600 });
const faultFile = value("--fault");
if (faultFile)
  writeFileSync(
    path.join(launch, "fault.json"),
    JSON.stringify({ ...JSON.parse(readFileSync(faultFile, "utf8")), id: randomUUID() }),
  );
const bundle = path.join(repo, "dist/pi-extension.mjs");
log("build_identity", {
  bundle,
  sha256: createHash("sha256").update(readFileSync(bundle)).digest("hex"),
  resume: !!resume,
});
const child = spawn(
  "pi",
  [
    "--mode",
    "rpc",
    "--offline",
    "--no-mcp",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-themes",
    "--extension",
    path.join(root, "trace-extension.js"),
    ...(resume ? ["--session", manifest.sessionFile] : ["--session-dir", path.join(run, "sessions")]),
    "--name",
    "Polish final product verification",
  ],
  {
    cwd: run,
    env: {
      ...process.env,
      POLISH_FINAL_LAUNCH: launch,
      POLISH_PI_STATE_ROOT: path.join(run, "polish-state"),
      LAVISH_AXI_TELEMETRY: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  },
);
manifest.livePid = child.pid;
manifest.launch = launch;
save();
const events = new EventEmitter();
const pending = new Map();
let direct,
  socket,
  endpoint,
  key,
  state,
  stopped = false,
  benchmark = false;
const samples = new Map();
function rpc(type, extra = {}) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`RPC timeout: ${type}`));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ ...extra, id, type }) + "\n");
  });
}
function waitEvent(name, predicate = () => true, ms = 120000) {
  let cancel = () => {};
  const promise = new Promise((resolve, reject) => {
    const done = (event) => {
      if (!predicate(event)) return;
      clearTimeout(timer);
      events.off(name, done);
      resolve(event);
    };
    const timer = setTimeout(() => {
      events.off(name, done);
      reject(new Error(`Timed out: ${name}`));
    }, ms);
    cancel = () => {
      clearTimeout(timer);
      events.off(name, done);
    };
    events.on(name, done);
  });
  // A failed RPC can cancel its accompanying event wait without leaving a timeout behind.
  promise.catch(() => {});
  return Object.assign(promise, { cancel: () => cancel() });
}
createInterface({ input: child.stdout }).on("line", (line) => {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    log("rpc_non_json", { line });
    return;
  }
  log("rpc_event", event);
  if (event.type === "response" && pending.has(event.id)) {
    const item = pending.get(event.id);
    pending.delete(event.id);
    clearTimeout(item.timer);
    if (event.success === false) item.reject(new Error(JSON.stringify(event)));
    else item.resolve(event.data);
  }
  if (
    direct &&
    event.type === "message_update" &&
    event.assistantMessageEvent?.type === "text_delta" &&
    direct.firstTokenAt === null
  )
    direct.firstTokenAt = now();
  if (direct && event.type === "message_end" && event.message?.role === "assistant")
    direct.stopReason = event.message.stopReason;
  events.emit(event.type, event);
});
child.stderr.on("data", (chunk) => log("pi_stderr", { text: String(chunk) }));
const input = createInterface({ input: process.stdin });
function stop(signal = "SIGTERM") {
  if (stopped) return;
  stopped = true;
  socket?.terminate();
  // ChildProcess owns the PID. Never accept a PID/port/session from the command stream.
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  input.close();
  process.stdin.destroy();
}
const deadline = setTimeout(() => stop(), 45 * 60000);
child.on("error", (error) => {
  log("spawn_error", { error: error.message });
  stop();
});
child.on("exit", (code, signal) => {
  log("pi_exit", { code, signal, pid: child.pid });
  manifest.livePid = null;
  save();
  clearTimeout(deadline);
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.reject(new Error("Owned Pi exited"));
  }
  pending.clear();
  stop();
});
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
async function http(route, body) {
  const started = now();
  log("http_start", { route, body });
  try {
    const response = await fetch(endpoint + route, {
      ...(body
        ? {
            method: "POST",
            headers: { "content-type": "application/json", Origin: endpoint },
            body: JSON.stringify(body),
          }
        : {}),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    log("http_response", { route, status: response.status, elapsedMs: now() - started, result });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    log("http_uncertain_or_rejected", { route, error: error.message });
    throw error;
  }
}
function observe(snapshot, source) {
  state = snapshot;
  for (const message of snapshot.messages || []) {
    const sample = samples.get(message.id);
    if (!sample || sample.completedAt || !message.reply) continue;
    sample.completedAt = now();
    sample.observedVia = source;
    log("review_sample", {
      ...sample,
      elapsedMs: sample.completedAt - sample.startedAt,
      reply: message.reply,
      state: message.state,
    });
  }
}
async function connect() {
  socket = new WebSocket(`${endpoint.replace(/^http/, "ws")}/events/${key}`, { origin: endpoint });
  socket.on("message", (raw) => {
    const event = JSON.parse(String(raw));
    log("ws_event", event);
    if (event.type === "polish-review") observe(event.data, "ws");
    events.emit("ws", event);
  });
  socket.on("error", (error) => log("ws_error", { error: error.message }));
  socket.on("close", () => log("ws_closed"));
  await once(socket, "open");
  log("ws_open");
  observe(await http(`/api/${key}/review`), "reconnect_snapshot");
}
async function submit(text, id = randomUUID()) {
  const snapshot = await http(`/api/${key}/review`);
  const body = {
    review_epoch: snapshot.epoch,
    prompts: [{ prompt_id: id, round_id: randomUUID(), scope: "session", prompt: text }],
  };
  appendFileSync(path.join(run, "submissions.jsonl"), JSON.stringify({ id, body }) + "\n");
  samples.set(id, { id, epoch: snapshot.epoch, clockID, startedAt: now() });
  await http(`/api/${key}/prompts`, body);
  return { id, body };
}
async function directBenchmark(count) {
  assert.ok(Number.isInteger(count) && count >= 30, "Direct comparison requires at least 30 samples");
  const snapshot = await http(`/api/${key}/review`);
  assert.ok(
    snapshot.messages.every((m) => m.reply || m.state === "failed"),
    "Use a quiet review for direct baseline",
  );
  assert.equal((await rpc("get_state")).isStreaming, false);
  benchmark = true;
  const batchID = randomUUID();
  log("direct_batch_started", { batchID, requested: count });
  try {
    for (let index = 1; index <= count; index++) {
      direct = { sampleID: randomUUID(), batchID, index, startedAt: now(), firstTokenAt: null, stopReason: null };
      log("direct_sample_started", direct);
      const settled = waitEvent("agent_settled");
      try {
        await rpc("prompt", { message: `性能验证 ${index}：不要修改文件、不要使用工具，只回复 OK。` });
        await settled;
        const sample = { ...direct, endedAt: now() };
        assert.equal(sample.stopReason, "stop", "Failed/aborted samples must not count as successful baseline");
        log("direct_sample", {
          ...sample,
          firstTokenMs: sample.firstTokenAt === null ? null : sample.firstTokenAt - sample.startedAt,
          totalMs: sample.endedAt - sample.startedAt,
        });
      } catch (error) {
        log("direct_sample_failed", { ...direct, endedAt: now(), error: error.message });
        throw error;
      } finally {
        settled.cancel();
        direct = null;
      }
    }
  } finally {
    direct = null;
    benchmark = false;
  }
  return { count };
}
async function calibrate(count) {
  assert.ok(Number.isInteger(count) && count >= 10, "Calibration requires at least 10 round trips");
  assert.equal((await rpc("get_state")).isStreaming, false, "Clock calibration uses extension commands while idle");
  const samples = [];
  for (let index = 0; index < count; index++) {
    const nonce = randomUUID();
    const response = waitEvent(
      "extension_ui_request",
      (event) => {
        if (!event.message?.startsWith("POLISH_VERIFY_CLOCK ")) return false;
        return JSON.parse(event.message.slice("POLISH_VERIFY_CLOCK ".length)).nonce === nonce;
      },
      10000,
    );
    const sentAt = now();
    try {
      const request = rpc("prompt", { message: `/polish-verify-clock ${nonce}` });
      // Observe receipt before waiting for RPC acknowledgement: include only actual round trip.
      request.catch(() => {});
      const event = await response;
      const receivedAt = now();
      await request;
      const witness = JSON.parse(event.message.slice("POLISH_VERIFY_CLOCK ".length));
      const sample = {
        nonce,
        supervisorClockID: clockID,
        sourceClockID: witness.clockID,
        sentAt,
        receivedAt,
        sourceAt: witness.at,
        rttMs: receivedAt - sentAt,
        offsetLowerMs: witness.at - receivedAt,
        offsetUpperMs: witness.at - sentAt,
      };
      samples.push(sample);
      log("clock_calibration_sample", sample);
    } finally {
      response.cancel();
    }
  }
  const best = samples.reduce((a, b) => (a.rttMs <= b.rttMs ? a : b));
  const result = {
    method: "sourceMinusSupervisor offset bounded by send/receive; no symmetric-delay assumption",
    samples,
    best,
    offsetEstimateMs: (best.offsetLowerMs + best.offsetUpperMs) / 2,
    uncertaintyMs: best.rttMs / 2,
  };
  log("clock_calibration", result);
  writeFileSync(path.join(launch, `source-calibration-${randomUUID()}.json`), JSON.stringify(result, null, 2));
  return result;
}
async function calibrateBrowser(websocket, count = 10) {
  const target = new URL(websocket);
  assert.equal(target.protocol, "ws:");
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.match(target.pathname, /^\/devtools\/page\/[a-zA-Z0-9_-]+$/);
  assert.ok(Number.isInteger(count) && count >= 10);
  const targetID = target.pathname.split("/").at(-1);
  const connection = new WebSocket(websocket);
  connection.on("error", () => {});
  try {
    await once(connection, "open");
    const samples = [];
    for (let index = 1; index <= count; index++) {
      const reply = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          connection.off("message", handle);
          reject(new Error("CDP clock timeout"));
        }, 10000);
        const handle = (raw) => {
          const receivedAt = now(),
            event = JSON.parse(String(raw));
          if (event.id !== index) return;
          clearTimeout(timer);
          connection.off("message", handle);
          if (event.error || event.result?.exceptionDetails) reject(new Error(JSON.stringify(event)));
          else resolve({ receivedAt, witness: event.result.result.value });
        };
        connection.on("message", handle);
      });
      const sentAt = now();
      connection.send(
        JSON.stringify({
          id: index,
          method: "Runtime.evaluate",
          params: {
            expression: `({clockID:${JSON.stringify(`browser:${targetID}:`)}+performance.timeOrigin,timeOrigin:performance.timeOrigin,at:performance.timeOrigin+performance.now()})`,
            returnByValue: true,
          },
        }),
      );
      const { receivedAt, witness } = await reply;
      const sample = {
        index,
        targetID,
        supervisorClockID: clockID,
        browserClockID: witness.clockID,
        browserTimeOrigin: witness.timeOrigin,
        browserAt: witness.at,
        sentAt,
        receivedAt,
        rttMs: receivedAt - sentAt,
        offsetLowerMs: witness.at - receivedAt,
        offsetUpperMs: witness.at - sentAt,
      };
      samples.push(sample);
      log("browser_clock_sample", sample);
    }
    assert.equal(new Set(samples.map((s) => s.browserClockID)).size, 1, "Browser navigated during calibration");
    const best = samples.reduce((a, b) => (a.rttMs <= b.rttMs ? a : b));
    const result = {
      method: "browserMinusSupervisor bounded offset via CDP Runtime.evaluate",
      samples,
      best,
      offsetEstimateMs: (best.offsetLowerMs + best.offsetUpperMs) / 2,
      uncertaintyMs: best.rttMs / 2,
    };
    log("browser_clock_calibration", result);
    writeFileSync(path.join(launch, `browser-calibration-${randomUUID()}.json`), JSON.stringify(result, null, 2));
    return result;
  } finally {
    connection.close();
  }
}
async function command(c) {
  if (c.op === "stop" || c.op === "kill") {
    stop(c.op === "kill" ? "SIGKILL" : "SIGTERM");
    return;
  }
  if (benchmark) throw new Error("Do not contaminate an active direct baseline");
  if (c.op === "clock") return { clockID, at: now() };
  if (c.op === "calibrate") return calibrate(c.count ?? 10);
  if (c.op === "browser-calibrate") return calibrateBrowser(c.websocket, c.count ?? 10);
  if (c.op === "direct") return directBenchmark(c.count ?? 30);
  if (c.op === "state") return http(`/api/${key}/review`);
  if (c.op === "submit") return submit(c.text || "不要修改文件、不要使用工具，只回复 OK。", c.id);
  if (c.op === "retry-submit") {
    const old = readFileSync(path.join(run, "submissions.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse)
      .find((m) => m.id === c.id);
    assert.ok(old, "Only an exact request recorded in this run can be retried");
    return http(`/api/${key}/prompts`, old.body);
  }
  if (c.op === "disconnect") {
    const ms = c.ms ?? 1500;
    assert.ok(ms >= 100 && ms <= 10000);
    const old = socket;
    const closed = once(old, "close");
    old.terminate();
    await closed;
    log("outage_begin", { ms });
    await new Promise((resolve) => setTimeout(resolve, ms));
    await connect();
    log("outage_end");
    return { ms, state };
  }
  if (c.op === "busy") {
    const count = c.count ?? 3;
    assert.ok(Number.isInteger(count) && count >= 2 && count <= 20);
    const started = waitEvent("agent_start");
    await rpc("prompt", { message: c.message || "不要使用工具。请用约400字说明简约界面的可读性，完成后停止。" });
    await started;
    assert.equal(
      (await rpc("get_state")).isStreaming,
      true,
      "Busy workload must be observed streaming before submission",
    );
    log("busy_submit_begin", { count });
    return Promise.all(
      Array.from({ length: count }, (_, i) => submit(`并发反馈 ${i + 1}：不要修改文件，不要使用工具，只回复 OK。`)),
    );
  }
  if (c.op === "arm-fault") {
    const allowed = [
      "accepted_durable",
      "dispatch_reserved",
      "host_admitted",
      "host_dispatching",
      "input_consumed",
      "model_start",
      "first_token",
      "host_reply_persisted",
      "reply_persisted",
      "end_sealed",
    ];
    assert.ok(allowed.includes(c.stage));
    const fault = { id: randomUUID(), stage: c.stage, match: c.match || {}, occurrence: c.occurrence || 1 };
    writeFileSync(path.join(launch, "fault.json"), JSON.stringify(fault));
    return fault;
  }
  if (c.op === "end") {
    const snapshot = await http(`/api/${key}/review`);
    assert.notEqual(manifest.endRequest?.epoch, snapshot.epoch, "Use retry-end to preserve an existing sealed request");
    const body = {
      id: randomUUID(),
      epoch: snapshot.epoch,
      final: c.text ? { id: randomUUID(), epoch: snapshot.epoch, text: c.text } : null,
    };
    manifest.endRequest = body;
    save();
    return http(`/api/${key}/review/end`, body);
  }
  if (c.op === "retry-end") {
    assert.ok(manifest.endRequest, "No recorded end request");
    return http(`/api/${key}/review/end`, manifest.endRequest);
  }
  if (c.op === "abort") return rpc("abort");
  throw new Error(`Unknown command: ${c.op}`);
}
try {
  let ready;
  const until = Date.now() + 45000;
  while (!ready && Date.now() < until && !stopped) {
    try {
      ready = JSON.parse(readFileSync(path.join(launch, "ready.json"), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "Pi did not produce its owned readiness record");
  assert.equal(ready.pid, child.pid);
  if (resume) {
    assert.equal(ready.sessionFile, manifest.sessionFile);
    assert.equal(ready.session, manifest.session, "Pi must not silently substitute a different session ID");
  }
  manifest.sessionFile = ready.sessionFile;
  manifest.session = ready.session;
  save();
  endpoint = ready.endpoint;
  assert.match(endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
  if (args.includes("--warmup")) {
    assert.equal(!!resume, false, "Warm-up is only for a new isolated fixture");
    log("durable_session_warmup_started");
    const settled = waitEvent("agent_settled", () => true, 180000);
    try {
      await rpc("prompt", { message: "独立验证会话初始化。不要使用工具、不要修改文件，只回复 READY。" });
      await settled;
    } finally {
      settled.cancel();
    }
    const header = JSON.parse(readFileSync(manifest.sessionFile, "utf8").split("\n")[0]);
    assert.equal(header.id, manifest.session);
    log("durable_session_warmup_complete", { session: manifest.session, sessionFile: manifest.sessionFile });
  }
  let opened;
  if (resume && !args.includes("--reopen")) {
    // Recovery reads the existing review, including ended. Never accidentally reopen it.
    let oldKey = manifest.key;
    if (!oldKey && previousLaunch)
      oldKey = readFileSync(path.join(previousLaunch, "client.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .find((event) => event.stage === "http_response" && event.metadata.route === "/api/sessions")?.metadata
        .result.key;
    assert.ok(oldKey, "Missing persisted review key; do not guess or open another review");
    opened = { key: oldKey, url: `${endpoint}/session/${oldKey}` };
    await http(`/api/${oldKey}/review`);
  } else {
    opened = await http("/api/sessions", { file: manifest.artifact, reopen: args.includes("--reopen") });
  }
  key = opened.key;
  assert.ok(key);
  manifest.key = key;
  save();
  await connect();
  console.log(
    JSON.stringify({
      ready: true,
      run,
      launch,
      artifact: manifest.artifact,
      session: manifest.session,
      url: opened.url,
      pid: child.pid,
    }),
  );
  input.on("line", (line) => {
    void (async () => {
      let c;
      try {
        c = JSON.parse(line);
        log("command", c);
        const result = await command(c);
        console.log(JSON.stringify({ op: c.op, result }));
      } catch (error) {
        log("command_error", { op: c?.op, error: error.message });
        console.error(JSON.stringify({ op: c?.op, error: error.message }));
      }
    })();
  });
} catch (error) {
  log("startup_error", { error: error.message });
  console.error(error);
  stop();
  process.exitCode = 1;
}
