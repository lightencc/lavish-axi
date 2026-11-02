import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { SessionStore } from "../src/session-store.js";
import { AsyncMutex } from "../src/async-mutex.js";
import { createPollHandler, restoreClaimedFeedback } from "../src/server.js";

// Only HTTP request/response boundaries are fakes. Handler and store are production code.
function harness(store) {
  const activePolls = new Map(),
    events = new EventEmitter();
  const handler = createPollHandler({
    store,
    activePolls,
    events,
    pollOwnershipLock: new AsyncMutex(),
    deliveredFeedback: new Set(),
    allowedHostnames: new Set(["127.0.0.1"]),
    allowAnyHostname: false,
    publishAgentReply: (key, text) => store.addAgentReply(key, text),
    restoreClosedFeedback: (key, result) => restoreClaimedFeedback(store, key, result),
    finishFeedbackDelivery: () => {},
    refreshIdleTimer: () => {},
    clearBrowserDisconnectTimer: () => {},
    browserDisconnectPending: new Set(),
    pollHeartbeatMs: 15000,
  });
  function invoke(file, method = "GET", extra = {}) {
    let resolveResponse;
    const finished = new Promise((resolve) => {
      resolveResponse = resolve;
    });
    const req = Object.assign(new EventEmitter(), {
      method,
      query: { file, timeoutMs: "1", ...extra },
      body: {},
      headers: {},
      get(name) {
        return this.headers[name.toLowerCase()];
      },
      aborted: false,
      destroyed: false,
    });
    const res = Object.assign(new EventEmitter(), {
      writableEnded: false,
      value: undefined,
      error: undefined,
      status() {
        return this;
      },
      type() {
        return this;
      },
      set() {
        return this;
      },
      write() {},
      json(value) {
        this.value = value;
        this.writableEnded = true;
        resolveResponse();
      },
      end(value) {
        this.json(JSON.parse(value));
      },
      destroy(error) {
        this.error = error;
        resolveResponse();
      },
    });
    let error;
    const done = handler(req, res, (e) => {
      error = e;
      resolveResponse();
    });
    return {
      req,
      res,
      done,
      finished,
      get error() {
        return error;
      },
    };
  }
  return { invoke, activePolls, events };
}

async function fixture(t, bound = true) {
  const dir = await mkdtemp(path.join(tmpdir(), "polish-poll-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "fixture.html");
  await writeFile(file, "<p>Isolated</p>");
  const store = new SessionStore(path.join(dir, "state.json"));
  const session = await store.upsertSession(file, "http://127.0.0.1:49793/");
  if (bound) await store.bindFeedback(session.key, { artifact: session.file, instance: "owned", session: "same" });
  return { store, key: session.key, file: session.file, ...harness(store) };
}

test("actual poll handler and bridge share mode/claim; output never proves Pi consumption", async (t) => {
  const f = await fixture(t);
  await f.store.queuePrompts(f.key, { prompts: [{ prompt_id: "r3-poll", prompt: "whole-page" }] });
  const denied = f.invoke(f.file);
  await denied.done;
  assert.match(denied.error.message, /MODE/);
  assert.equal(f.activePolls.size, 0);
  const oldBridge = await f.store.feedbackLease(f.key, "bridge");
  await f.store.setFeedbackMode(f.key, "poll");
  const poll = f.invoke(f.file);
  await poll.done;
  assert.equal(poll.res.value.delivery.id, "r3-poll");
  assert.equal((await f.store.feedbackSnapshot(f.key)).messages[0].consumed, false);
  await assert.rejects(f.store.takeFeedback(f.key, oldBridge), /STALE/);
  assert.equal(f.activePolls.size, 0);
});

test("disconnect after real destructive take preserves same unknown attempt, never restores to deliverable queue", async (t) => {
  const f = await fixture(t);
  await f.store.setFeedbackMode(f.key, "poll");
  await f.store.queuePrompts(f.key, { prompts: [{ prompt_id: "r3-close", prompt: "test" }] });
  const take = f.store.takeFeedback.bind(f.store);
  let req;
  f.store.takeFeedback = async (...args) => {
    const result = await take(...args);
    req.emit("close");
    return result;
  };
  const poll = f.invoke(f.file);
  req = poll.req;
  await poll.done;
  assert.equal(poll.res.value, undefined);
  assert.equal(f.activePolls.size, 0);
  const s = await f.store.feedbackSnapshot(f.key);
  assert.equal(s.messages[0].state, "unknown");
  assert.equal(s.messages[0].consumed, false);
  assert.equal((await f.store.findByKey(f.key)).prompts.length, 0);
  const attempt = s.messages[0].claim.attempt;
  await f.store.reconcileFeedback(f.key, {
    ...s.messages[0].claim,
    kind: "consumed",
    inputEvidence: "context_with_system",
    evidenceId: "host-positive",
  });
  assert.equal((await f.store.feedbackSnapshot(f.key)).messages[0].claim.attempt, attempt);
});

test("unbound legacy GET and POST takeover retain native feedback and listener cleanup", async (t) => {
  const f = await fixture(t, false);
  for (const method of ["GET", "POST"]) {
    await f.store.queuePrompts(f.key, { prompts: [{ prompt: method }] });
    const poll = f.invoke(f.file, method, method === "POST" ? { takeover: "1" } : {});
    await poll.done;
    assert.equal(poll.error, undefined);
    assert.equal(poll.res.value.status, "feedback");
    assert.equal(poll.res.value.delivery, undefined);
    assert.equal(poll.res.value.prompts[0].prompt, method);
    assert.equal(f.activePolls.size, 0);
  }
});

test(
  "event-driven actual poll takes through the same lease and leaves input unconsumed",
  { timeout: 2000 },
  async (t) => {
    const f = await fixture(t);
    await f.store.setFeedbackMode(f.key, "poll");
    const poll = f.invoke(f.file, "GET", { timeoutMs: "1500" });
    await poll.done;
    assert.equal(f.activePolls.size, 1);
    await f.store.queuePrompts(f.key, { prompts: [{ prompt_id: "r3-event", prompt: "later feedback" }] });
    f.events.emit("feedback", f.key);
    await poll.finished;
    assert.equal(poll.error, undefined);
    assert.equal(poll.res.value.delivery.id, "r3-event");
    assert.equal((await f.store.feedbackSnapshot(f.key)).messages[0].consumed, false);
    assert.equal(f.activePolls.size, 0);
  },
);

test(
  "mode switch fences an already-waiting actual poll before its later destructive take",
  { timeout: 2000 },
  async (t) => {
    const f = await fixture(t);
    await f.store.setFeedbackMode(f.key, "poll");
    const poll = f.invoke(f.file, "GET", { timeoutMs: "1500" });
    await poll.done;
    await f.store.setFeedbackMode(f.key, "bridge");
    await f.store.queuePrompts(f.key, { prompts: [{ prompt_id: "r3-fenced", prompt: "bridge only" }] });
    f.events.emit("feedback", f.key);
    await poll.finished;
    assert.match(poll.error.message, /STALE/);
    assert.equal((await f.store.feedbackSnapshot(f.key)).messages[0].state, "accepted");
    assert.equal(f.activePolls.size, 0);
  },
);
