import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { SessionStore } from "../src/session-store.js";
import { createPolishReview } from "../src/polish-review.js";
import { createPiHost } from "../src/pi-host.js";

// Durable-store reloads at controlled boundaries, not SIGKILL tests or actual Pi acceptance evidence.
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "polish-lifecycle-fault-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "artifact.html");
  await writeFile(file, "<!doctype html><p>Lifecycle fixture</p>");
  const store = new SessionStore(path.join(dir, "state.json"));
  const session = await store.upsertSession(file, "http://127.0.0.1/");
  const { key } = session;
  const binding = { artifact: session.file, instance: "fault-fixture-host", session: "fault-fixture-session" };
  await store.bindFeedback(key, binding);
  return { store, key, binding };
}
const prompt = (id) => ({ prompt_id: id, prompt: `Feedback ${id}`, scope: "session", round_id: `round-${id}` });
const endRequest = { id: "fixed-end", epoch: 1, final: { id: "fixed-final", text: "Final feedback", epoch: 1 } };
const consumed = (claim) => ({
  ...claim,
  kind: "consumed",
  evidenceId: `input-${claim.id}`,
  inputEvidence: "context_with_system",
});

for (const first of ["submit", "end"]) {
  test(`A19: ${first} wins the store lock; simultaneous ordinary submission and end seal one fixed collection`, async (t) => {
    const { store, key } = await fixture(t);
    const submit = () => store.queuePrompts(key, { review_epoch: 1, prompts: [prompt("racing-submit")] });
    const end = () => store.beginFeedbackEnd(key, endRequest);
    const calls = first === "submit" ? [submit, end] : [end, submit];
    const results = await Promise.allSettled(calls.map((call) => call()));
    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[1].status, first === "submit" ? "fulfilled" : "rejected");
    const state = await store.feedbackSnapshot(key);
    const ids =
      first === "submit" ? ["racing-submit", "fixed-final", "fixed-end-marker"] : ["fixed-final", "fixed-end-marker"];
    assert.deepEqual(state.end.ids, ids);
    assert.deepEqual(
      state.messages.map((m) => m.id),
      ids,
    );
    await store.beginFeedbackEnd(key, endRequest);
    await assert.rejects(
      store.beginFeedbackEnd(key, { ...endRequest, final: { ...endRequest.final, text: "Changed" } }),
      /CONFLICT/,
    );
    assert.deepEqual((await store.feedbackSnapshot(key)).end.ids, ids);
  });
}

for (const boundary of ["sealed-before-take", "reserved-before-host-receipt", "host-queued-before-consumption"]) {
  test(`A17/A20: reload at ${boundary} preserves the sealed collection and never invents consumption`, async (t) => {
    const { store, key } = await fixture(t);
    await store.queuePrompts(key, { review_epoch: 1, prompts: [prompt("before-end")] });
    await store.beginFeedbackEnd(key, endRequest);
    const sealed = await store.feedbackSnapshot(key);
    let first;
    if (boundary !== "sealed-before-take") {
      first = await store.takeFeedback(key, await store.feedbackLease(key, "bridge"));
      await store.reserveFeedbackHost(key, first.delivery);
      if (boundary === "host-queued-before-consumption") {
        await store.recordFeedback(key, first.delivery, {
          ...first.delivery,
          kind: "queued",
          evidenceId: "host-queue",
        });
      }
    }
    const recovered = new SessionStore(store.file);
    await recovered.recoverFeedback(key);
    const restored = await recovered.feedbackSnapshot(key);
    assert.deepEqual(restored.end, sealed.end);
    assert.equal(restored.lifecycle, "ending");
    assert.ok(restored.messages.every((m) => !m.consumed));
    if (first) {
      assert.equal(restored.messages[0].state, "unknown");
      assert.deepEqual(restored.messages[0].claim, first.delivery);
      assert.equal((await recovered.takeFeedback(key, await recovered.feedbackLease(key, "bridge"))).status, "waiting");
      await assert.rejects(recovered.reserveFeedbackHost(key, first.delivery), /STALE/);
      await recovered.reconcileFeedback(key, consumed(first.delivery));
      await recovered.reconcileFeedback(key, consumed(first.delivery));
    }
    const remaining = first ? sealed.end.ids.slice(1) : sealed.end.ids;
    for (const id of remaining) {
      assert.equal((await recovered.feedbackSnapshot(key)).lifecycle, "ending");
      const result = await recovered.takeFeedback(key, await recovered.feedbackLease(key, "bridge"));
      assert.equal(result.delivery.id, id);
      await recovered.reserveFeedbackHost(key, result.delivery);
      await recovered.recordFeedback(key, result.delivery, consumed(result.delivery));
    }
    assert.equal((await recovered.feedbackSnapshot(key)).lifecycle, "ended");
    assert.deepEqual((await recovered.feedbackSnapshot(key)).end, sealed.end);
  });
}

test("A18/A20: temporary host query failure preserves unknown ending and does not abort recovery of other bound artifacts", async (t) => {
  const { store, key, binding } = await fixture(t);
  await store.beginFeedbackEnd(key, endRequest);
  const claim = (await store.takeFeedback(key, await store.feedbackLease(key, "bridge"))).delivery;
  await store.reserveFeedbackHost(key, claim);
  const siblingFile = path.join(path.dirname(store.file), "sibling.html");
  await writeFile(siblingFile, "<!doctype html><p>Other review</p>");
  const sibling = await store.upsertSession(siblingFile, "http://127.0.0.1/");
  await store.bindFeedback(sibling.key, { ...binding, artifact: sibling.file });
  const deliveries = [],
    logs = [];
  const review = createPolishReview({
    store: new SessionStore(store.file),
    events: new EventEmitter(),
    log: (message) => logs.push(message),
    host: {
      ...binding,
      setReceiver() {},
      query: async () => {
        throw new Error("HOST_TEMPORARILY_UNAVAILABLE");
      },
      deliver: async (...args) => {
        deliveries.push(args);
      },
    },
  });
  t.after(() => review.close());
  await assert.doesNotReject(
    review.recover(),
    "query outage must remain an unknown delivery, not abort all artifact recovery",
  );
  assert.equal((await review.snapshot(key)).lifecycle, "ending");
  assert.equal((await review.snapshot(key)).messages[0].state, "unknown");
  assert.equal((await review.snapshot(sibling.key)).generation, 2, "other bound artifacts must still recover");
  assert.deepEqual(deliveries, [], "query failure is not permission to redeliver");
  assert.ok(logs.some((message) => message.includes("HOST_TEMPORARILY_UNAVAILABLE")));
});

test("A20/A21: empty recovery query never redelivers; a later exact witness drains remaining end members once", async (t) => {
  const { store, key, binding } = await fixture(t);
  await store.queuePrompts(key, { review_epoch: 1, prompts: [prompt("unknown-original")] });
  await store.beginFeedbackEnd(key, endRequest);
  const oldLease = await store.feedbackLease(key, "bridge");
  const first = await store.takeFeedback(key, oldLease);
  await store.reserveFeedbackHost(key, first.delivery);
  const recovered = new SessionStore(store.file),
    deliveries = [];
  let positive = false;
  const review = createPolishReview({
    store: recovered,
    events: new EventEmitter(),
    host: {
      ...binding,
      setReceiver() {},
      query: async (message) => (positive ? consumed(message.claim) : null),
      deliver: async (_message, claim) => {
        deliveries.push(claim.id);
        return consumed(claim);
      },
    },
  });
  t.after(() => review.close());
  await review.recover();
  await review.pump(key);
  assert.deepEqual(deliveries, []);
  assert.equal((await recovered.feedbackSnapshot(key)).lifecycle, "ending");
  await assert.rejects(recovered.takeFeedback(key, oldLease), /STALE/);
  await assert.rejects(recovered.feedbackLease(key, "poll"), /MODE/);
  positive = true;
  await review.recover();
  await review.pump(key);
  assert.deepEqual(deliveries, ["fixed-final", "fixed-end-marker"]);
  const ended = await recovered.feedbackSnapshot(key);
  assert.equal(ended.lifecycle, "ended");
  assert.deepEqual(ended.end.ids, ["unknown-original", "fixed-final", "fixed-end-marker"]);
  assert.equal(ended.messages[0].claim.attempt, first.delivery.attempt);
});

for (const result of ["queued", "timeout"]) {
  test(`A18: host ${result} leaves the exact sealed end batch pending without automatic resubmission`, async (t) => {
    const { store, key, binding } = await fixture(t);
    let calls = 0;
    const review = createPolishReview({
      store,
      events: new EventEmitter(),
      host: {
        ...binding,
        setReceiver() {},
        query: async () => null,
        deliver: async (_message, claim) => {
          calls++;
          if (result === "timeout") throw new Error("HOST_CALL_TIMEOUT");
          return { ...claim, kind: "queued", evidenceId: "busy-host-queue" };
        },
      },
    });
    t.after(() => review.close());
    await review.end(key, endRequest);
    await review.pump(key);
    await review.pump(key);
    const state = await store.feedbackSnapshot(key);
    assert.equal(state.lifecycle, "ending");
    assert.equal(state.messages[0].state, result === "timeout" ? "unknown" : "host_queued");
    assert.equal(state.messages[0].consumed, false);
    assert.equal(state.messages[1].state, "accepted", "end marker cannot overtake unconsumed final feedback");
    assert.deepEqual(state.end.ids, ["fixed-final", "fixed-end-marker"]);
    assert.equal(calls, 1, "calling the pump again cannot repeat an uncertain host call");
  });
}

test("a restarted host reports consumed processing without a reply as execution unknown, while a live processing query stays active", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "polish-processing-recovery-"));
  const handlers = new Map(),
    entries = [],
    sent = [];
  let host, review;
  t.after(async () => {
    review?.close();
    host?.close();
    await rm(dir, { recursive: true, force: true });
  });
  const pi = {
    on(name, callback) {
      handlers.set(name, callback);
      return () => handlers.delete(name);
    },
    sendMessage(message) {
      sent.push(message);
      entries.push({ id: "processing-input", type: "custom_message", ...message });
    },
  };
  const ctx = {
    sessionManager: { getSessionId: () => "processing-recovery-session", getBranch: () => entries },
    isIdle: () => true,
    hasPendingMessages: () => false,
  };
  const artifact = path.join(dir, "artifact.html");
  await writeFile(artifact, "<!doctype html><p>Interrupted processing</p>");
  host = await createPiHost(pi, ctx, path.join(dir, "host"));
  const store = new SessionStore(path.join(dir, "state.json"));
  const session = await store.upsertSession(artifact, "http://127.0.0.1/");
  await store.bindFeedback(session.key, { artifact: session.file, instance: host.instance, session: host.session });
  review = createPolishReview({ store, events: new EventEmitter(), host });
  await store.queuePrompts(session.key, { review_epoch: 1, prompts: [prompt("interrupted-processing")] });
  await review.pump(session.key);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1);
  await handlers.get("context_with_system")({ messages: [{ role: "custom", ...sent[0] }] });
  const original = (await store.feedbackSnapshot(session.key)).messages[0];
  const liveProof = await host.query(original);
  assert.equal(liveProof.kind, "consumed");
  assert.notEqual(liveProof.executionUnknown, true, "ordinary query of a still-running turn is not an interruption");
  review.close();
  host.close();
  host = await createPiHost(pi, ctx, path.join(dir, "host"));
  const recoveredProof = await host.query(original);
  assert.equal(recoveredProof.kind, "consumed", "restart must preserve the exact verified consumption fact");
  assert.equal(
    recoveredProof.executionUnknown,
    true,
    "a new host incarnation cannot promise the interrupted model turn is still processing",
  );
  assert.equal(recoveredProof.attempt, original.claim.attempt);
  const recovered = new SessionStore(store.file);
  review = createPolishReview({ store: recovered, events: new EventEmitter(), host });
  await review.recover();
  host.start();
  await review.pump(session.key);
  await new Promise((resolve) => setImmediate(resolve));
  const message = (await recovered.feedbackSnapshot(session.key)).messages[0];
  assert.equal(message.consumed, true);
  assert.equal(
    message.executionUnknown,
    true,
    "the UI must receive a persisted interruption fact, not a forever-processing state",
  );
  assert.equal(message.reply, undefined);
  assert.notEqual(message.state, "failed", "a lost execution is not invented assistant failure evidence");
  assert.equal(sent.length, 1, "recovery must never rerun the original consumed input automatically");
});
