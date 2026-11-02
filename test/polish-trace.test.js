import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createPiHost } from "../src/pi-host.js";
import { createPolishReview } from "../src/polish-review.js";
import { SessionStore } from "../src/session-store.js";
import { serve } from "../src/server.js";

const disk = (file) => JSON.parse(readFileSync(file, "utf8"));
const flush = () => new Promise((resolve) => setImmediate(resolve));
const consume = (claim) => ({
  ...claim,
  kind: "consumed",
  evidenceId: `input-${claim.id}`,
  inputEvidence: "context_with_system",
});
const one = (traces, stage) => {
  const matching = traces.filter((entry) => entry.stage === stage);
  assert.equal(matching.length, 1, `expected exactly one ${stage} trace`);
  return matching[0];
};

// Real production host persistence and Pi hooks; the Pi runtime itself is a controlled substitute.
test("Pi trace stages observe committed host state, exact input witness, and only the first text delta without content", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "polish-trace-host-"));
  const handlers = new Map(),
    entries = [],
    sent = [],
    receipts = [],
    traces = [];
  let idle = false,
    host;
  t.after(async () => {
    host?.close();
    await rm(dir, { recursive: true, force: true });
  });
  const pi = {
    on(name, handler) {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
    sendMessage(message) {
      sent.push(message);
      entries.push({ id: "trace-input", type: "custom_message", ...message });
    },
  };
  const ctx = {
    isIdle: () => idle,
    hasPendingMessages: () => false,
    sessionManager: { getSessionId: () => "trace-session", getBranch: () => entries },
  };
  host = await createPiHost(pi, ctx, dir, {
    trace(stage, metadata) {
      traces.push({
        stage,
        metadata: structuredClone(metadata),
        state: disk(path.join(dir, "host.json")),
        sent: sent.length,
        receipts: receipts.length,
      });
    },
  });
  host.setReceiver(async (_key, proof) => {
    receipts.push(proof);
  });
  const text = JSON.stringify({ prompt: "TRACE_PRIVATE_PROMPT", scope: "session", round_id: "trace-round" });
  const claim = {
    artifact: "/tmp/polish-trace-artifact.html",
    instance: host.instance,
    session: host.session,
    epoch: 1,
    generation: 1,
    mode: "bridge",
    id: "trace-message",
    attempt: "trace-attempt",
    digest: createHash("sha256").update(text).digest("hex"),
  };
  const message = { id: claim.id, text, prompt: JSON.parse(text), kind: "message" };
  await host.deliver(message, claim);
  const admitted = one(traces, "host_admitted");
  assert.equal(admitted.state.messages[0].state, "accepted");
  assert.equal(admitted.state.messages[0].claim.id, claim.id);
  assert.equal(admitted.sent, 0, "admission measures before any Pi send");
  idle = true;
  host.start();
  await flush();
  const dispatching = one(traces, "host_dispatching");
  assert.equal(dispatching.state.messages[0].state, "dispatching");
  assert.equal(dispatching.sent, 0, "dispatch timing must be recorded before sendMessage");
  assert.equal(sent.length, 1);
  await assert.rejects(
    handlers.get("context_with_system")({
      messages: [{ role: "custom", ...sent[0], details: { ...claim, attempt: "wrong-attempt" } }],
    }),
    /POLISH_INPUT_IDENTITY/,
  );
  assert.equal(traces.filter((entry) => entry.stage === "input_consumed").length, 0);
  assert.equal(disk(path.join(dir, "host.json")).messages[0].inputEntryId, undefined);
  await handlers.get("context_with_system")({ messages: [{ role: "custom", ...sent[0] }] });
  const consumed = one(traces, "input_consumed");
  assert.equal(consumed.state.messages[0].inputEntryId, "trace-input");
  assert.equal(consumed.state.messages[0].state, "processing");
  assert.equal(consumed.receipts, 0, "input trace precedes notification of its newly durable receipt");
  assert.equal(receipts[0].kind, "consumed");
  assert.equal(typeof handlers.get("message_update"), "function");
  await handlers.get("message_update")({
    assistantMessageEvent: { type: "thinking_delta", delta: "PRIVATE_THINKING" },
  });
  assert.equal(traces.filter((entry) => entry.stage === "first_token").length, 0);
  await handlers.get("message_update")({
    assistantMessageEvent: { type: "text_delta", delta: "TRACE_PRIVATE_FIRST_TOKEN" },
  });
  await handlers.get("message_update")({
    assistantMessageEvent: { type: "text_delta", delta: "TRACE_PRIVATE_SECOND_TOKEN" },
  });
  const token = one(traces, "first_token");
  assert.equal(token.state.messages[0].inputEntryId, "trace-input");
  const assistant = { role: "assistant", content: [{ type: "text", text: "TRACE_PRIVATE_REPLY" }], stopReason: "stop" };
  entries.push({ id: "trace-reply", type: "message", message: assistant });
  await handlers.get("turn_end")({ message: assistant, messageEntryId: "trace-reply" });
  const replied = one(traces, "host_reply_persisted");
  assert.equal(replied.state.messages[0].reply.entryId, "trace-reply");
  assert.equal(replied.state.messages[0].reply.text, "TRACE_PRIVATE_REPLY");
  assert.equal(replied.receipts, 1, "reply trace precedes notification of its newly durable receipt");
  assert.equal(receipts.at(-1).kind, "reply");
  await host.deliver(message, claim);
  assert.equal(
    traces.filter((entry) => entry.stage === "host_admitted").length,
    1,
    "idempotent admission is not a second latency sample",
  );
  for (const trace of traces) {
    assert.equal(trace.metadata.id, claim.id);
    assert.equal(trace.metadata.attempt, claim.attempt);
    assert.doesNotMatch(JSON.stringify(trace.metadata), /TRACE_PRIVATE|PRIVATE_THINKING/);
  }
});

async function reviewFixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "polish-trace-review-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const artifact = path.join(dir, "artifact.html");
  await writeFile(artifact, "<!doctype html><p>Trace fixture</p>");
  const store = new SessionStore(path.join(dir, "state.json"));
  const session = await store.upsertSession(artifact, "http://127.0.0.1/");
  const binding = { artifact: session.file, instance: "trace-host", session: "trace-session" };
  await store.bindFeedback(session.key, binding);
  return { dir, artifact, store, key: session.key, binding };
}

test("review traces follow committed host reservation, exact reply and fixed end set before publishing those facts", async (t) => {
  const { store, key, binding } = await reviewFixture(t);
  const events = new EventEmitter(),
    traces = [],
    deliveries = [],
    published = [];
  events.on("polish-review", (_key, state) => published.push(state));
  const review = createPolishReview({
    store,
    events,
    host: {
      ...binding,
      setReceiver() {},
      query: async () => null,
      deliver: async (_message, claim) => {
        deliveries.push(claim);
        return { ...claim, kind: "queued", evidenceId: "trace-queued" };
      },
    },
    trace(stage, metadata) {
      traces.push({
        stage,
        metadata: structuredClone(metadata),
        state: disk(store.file).sessions[key].review_delivery,
        deliveries: deliveries.length,
        published: published.length,
      });
    },
  });
  t.after(() => review.close());
  await store.queuePrompts(key, {
    review_epoch: 1,
    prompts: [
      {
        prompt_id: "trace-review-message",
        prompt: "TRACE_PRIVATE_PROMPT",
        scope: "session",
        round_id: "trace-review-round",
      },
    ],
  });
  await review.pump(key);
  const reserved = one(traces, "dispatch_reserved");
  assert.equal(reserved.state.messages[0].host_dispatched, true);
  assert.equal(reserved.state.messages[0].state, "dispatching");
  assert.equal(reserved.deliveries, 0);
  const claim = deliveries[0];
  const countBeforeReply = published.length;
  await review.receive(key, {
    ...consume(claim),
    kind: "reply",
    evidenceId: "trace-reviewed-reply",
    replyTo: claim.id,
    round_id: "trace-review-round",
    text: "TRACE_PRIVATE_REPLY",
  });
  const replied = one(traces, "reply_persisted");
  assert.equal(replied.state.messages[0].reply.text, "TRACE_PRIVATE_REPLY");
  assert.equal(replied.state.messages[0].reply.reply_to, claim.id);
  assert.equal(replied.published, countBeforeReply, "reply trace precedes the broadcast carrying that reply");
  const countBeforeEnd = published.length;
  await review.end(key, {
    id: "trace-end",
    epoch: 1,
    final: { id: "trace-final", text: "TRACE_PRIVATE_FINAL", epoch: 1 },
  });
  const sealed = one(traces, "end_sealed");
  assert.equal(sealed.state.lifecycle, "ending");
  assert.deepEqual(sealed.state.end.ids, ["trace-review-message", "trace-final", "trace-end-marker"]);
  assert.equal(sealed.published, countBeforeEnd);
  await review.pump(key);
  for (const trace of traces) assert.doesNotMatch(JSON.stringify(trace.metadata), /TRACE_PRIVATE/);
});

test("HTTP accepted_durable trace observes committed prompts before feedback can dispatch to the host", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "polish-trace-http-"));
  let server;
  t.after(async () => {
    await server?.close();
    await rm(dir, { recursive: true, force: true });
  });
  const artifact = path.join(dir, "artifact.html"),
    stateFile = path.join(dir, "state.json");
  await writeFile(artifact, "<!doctype html><p>Trace HTTP fixture</p>");
  const traces = [],
    deliveries = [];
  server = await serve({
    port: 0,
    hosts: ["127.0.0.1"],
    stateFile,
    idleTimeoutMs: null,
    detectTailscale: async () => null,
    env: {
      ...process.env,
      LAVISH_AXI_STATE_DIR: dir,
      LAVISH_AXI_HOST: "127.0.0.1",
      LAVISH_AXI_LINK_HOST: "127.0.0.1",
      LAVISH_AXI_TELEMETRY: "0",
    },
    polishHost: {
      instance: "trace-http-host",
      session: "trace-http-session",
      setReceiver() {},
      query: async () => null,
      deliver: async (_message, claim) => {
        deliveries.push(claim);
        return { ...claim, kind: "queued", evidenceId: "http-queued" };
      },
    },
    polishTrace(stage, metadata) {
      traces.push({
        stage,
        metadata: structuredClone(metadata),
        state: disk(stateFile),
        deliveries: deliveries.length,
      });
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  const post = (route, body) =>
    fetch(base + route, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const { key } = await (await post("/api/sessions", { file: artifact })).json();
  const response = await post(`/api/${key}/prompts`, {
    review_epoch: 1,
    prompts: [
      { prompt_id: "trace-http-message", prompt: "TRACE_PRIVATE_HTTP", scope: "session", round_id: "trace-http-round" },
    ],
  });
  assert.equal(response.status, 200);
  const accepted = one(traces, "accepted_durable");
  const message = accepted.state.sessions[key].review_delivery.messages.find((m) => m.id === "trace-http-message");
  assert.equal(message.state, "accepted");
  assert.equal(message.consumed, false);
  assert.equal(accepted.deliveries, 0);
  assert.doesNotMatch(JSON.stringify(accepted.metadata), /TRACE_PRIVATE_HTTP/);
});

test("an observer trace exception cannot strand a reserved delivery or prevent a sealed end batch from draining", async (t) => {
  const { store, key, binding } = await reviewFixture(t);
  const deliveries = [];
  const review = createPolishReview({
    store,
    events: new EventEmitter(),
    trace() {
      throw new Error("TRACE_SINK_UNAVAILABLE");
    },
    host: {
      ...binding,
      setReceiver() {},
      query: async () => null,
      deliver: async (_message, claim) => {
        deliveries.push(claim.id);
        return consume(claim);
      },
    },
  });
  t.after(() => review.close());
  await store.queuePrompts(key, {
    review_epoch: 1,
    prompts: [{ prompt_id: "observer-fault", prompt: "Observe without changing delivery" }],
  });
  await review.pump(key);
  assert.deepEqual(
    deliveries,
    ["observer-fault"],
    "a metrics sink failure must not occur between reservation and the actual host call",
  );
  assert.equal((await store.feedbackSnapshot(key)).messages[0].consumed, true);
  await assert.doesNotReject(review.end(key, { id: "observer-end", epoch: 1 }));
  await review.pump(key);
  assert.deepEqual(deliveries, ["observer-fault", "observer-end-marker"]);
  assert.equal((await store.feedbackSnapshot(key)).lifecycle, "ended");
});
