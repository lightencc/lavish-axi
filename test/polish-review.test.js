import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionStore } from "../src/session-store.js";
import { createPolishReview } from "../src/polish-review.js";
import { createPiHost } from "../src/pi-host.js";

// Real file-backed SessionStore; receipts are explicit trusted-adapter test fixtures, not Pi evidence.
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "polish-review-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "fixture.html");
  await writeFile(file, '<!doctype html><p id="alpha">Alpha paragraph</p><p id="beta">Beta paragraph</p>');
  const store = new SessionStore(path.join(dir, "state.json"));
  const session = await store.upsertSession(file, "http://127.0.0.1:49793/");
  const binding = { artifact: session.file, instance: "owned-pi", session: "owned-session" };
  await store.bindFeedback(session.key, binding);
  return { store, key: session.key, binding };
}

function anchored(id, comment = "comment-alpha", block = "alpha") {
  return {
    prompt_id: id,
    scope: "anchored",
    comment_id: comment,
    round_id: randomUUID(),
    selector: `#${block}`,
    text: block === "alpha" ? "Alpha paragraph" : "Beta paragraph",
    prompt: `Revise ${block}`,
  };
}
const sessionPrompt = (id) => ({
  prompt_id: id,
  scope: "session",
  round_id: randomUUID(),
  prompt: "Revise the overall page",
});
const queue = (store, key, prompts, epoch = 1) => store.queuePrompts(key, { review_epoch: epoch, prompts });
const message = (snapshot, id) => snapshot.messages.find((m) => m.id === id);
const consumed = (delivery) => ({
  ...delivery,
  kind: "consumed",
  evidenceId: `input-${delivery.id}`,
  inputEvidence: "context_with_system",
});
function replyProof(result, text = "Revision ready") {
  return {
    ...consumed(result.delivery),
    kind: "reply",
    evidenceId: `reply-${result.delivery.id}`,
    replyTo: result.delivery.id,
    comment_id: result.prompts[0].comment_id,
    round_id: result.prompts[0].round_id,
    text,
  };
}
async function take(store, key) {
  const result = await store.takeFeedback(key, await store.feedbackLease(key, "bridge"));
  assert.equal(result.status, "feedback");
  await store.reserveFeedbackHost(key, result.delivery);
  return result;
}
async function replyNext(store, key, text) {
  const result = await take(store, key);
  const proof = replyProof(result, text);
  await store.reconcileFeedback(key, proof);
  return { result, proof };
}
async function completion(store, key, prompt, epoch = 1) {
  const current = message(await store.feedbackSnapshot(key), prompt.prompt_id);
  assert.ok(current.reply, "a precise reply must be stored before completion can be requested");
  return {
    epoch,
    comment_id: prompt.comment_id,
    round_id: prompt.round_id,
    reply_version: current.reply.version,
    artifact_revision: (await store.findByKey(key)).artifact_revision,
  };
}

async function loadReviewedArtifact(store, key) {
  const handoff = await store.issueReviewerHandoff(key);
  const load = await store.beginArtifactLoad(key, {
    requestId: randomUUID(),
    requestSequence: handoff.artifact_load_sequence + 1,
    handoffToken: handoff.chrome_load_token,
  });
  assert.ok(load.artifact_load_token);
  const html = await readFile((await store.findByKey(key)).file, "utf8");
  await store.recordReviewArtifact(key, load.artifact_load_token, html);
  const snapshot = await store.feedbackSnapshot(key);
  assert.equal(snapshot.artifact_load_token, load.artifact_load_token);
  assert.match(snapshot.artifact_digest, /^[a-f0-9]{64}$/);
  return { artifact_load_token: load.artifact_load_token, artifact_digest: snapshot.artifact_digest };
}

test("precise reply text and version persist; wrong replyTo never answers a different message", async (t) => {
  const { store, key } = await fixture(t);
  const a = anchored("review-reply-a");
  await queue(store, key, [a]);
  const result = await take(store, key);
  await assert.rejects(
    store.reconcileFeedback(key, { ...replyProof(result), replyTo: "another-message" }),
    /IDENTITY|REPLY/,
  );
  assert.equal(message(await store.feedbackSnapshot(key), a.prompt_id).state, "dispatching");
  const proof = replyProof(result, "Only alpha changed");
  await store.reconcileFeedback(key, proof);
  const first = message(await store.feedbackSnapshot(key), a.prompt_id);
  assert.equal(first.reply.text, "Only alpha changed");
  assert.ok(Number.isSafeInteger(first.reply.version) && first.reply.version > 0);
  assert.equal(first.resolved, false, "agent reply is not user completion");
  await store.reconcileFeedback(key, proof);
  const reloaded = message(await new SessionStore(store.file).feedbackSnapshot(key), a.prompt_id);
  assert.deepEqual(reloaded.reply, first.reply, "same reply receipt replay must not create a newer reply version");
});

test("session submissions strip fabricated location; anchored submissions require selector and quote", async (t) => {
  const { store, key } = await fixture(t);
  const whole = { ...sessionPrompt("review-session"), selector: "#alpha", tag: "p", text: "Alpha paragraph" };
  await queue(store, key, [whole]);
  const stored = message(await store.feedbackSnapshot(key), whole.prompt_id);
  assert.equal(stored.prompt.scope, "session");
  for (const field of ["selector", "tag", "text"]) {
    assert.equal(Object.hasOwn(stored.prompt, field), false, `session prompt must omit ${field}`);
  }
  assert.equal(stored.prompt.comment_id, undefined);
  const result = await take(store, key);
  for (const field of ["selector", "tag", "text"]) assert.equal(Object.hasOwn(result.prompts[0], field), false);
  await store.reconcileFeedback(key, consumed(result.delivery));
  await assert.rejects(
    queue(store, key, [{ ...anchored("review-no-selector"), selector: "" }]),
    /ANCHOR|SELECTOR|INVALID/,
  );
  await assert.rejects(queue(store, key, [{ ...anchored("review-no-quote"), text: "" }]), /ANCHOR|QUOTE|INVALID/);
  const located = anchored("review-located");
  await queue(store, key, [located]);
  const delivered = await take(store, key);
  assert.equal(delivered.prompts[0].selector, "#alpha");
  assert.equal(delivered.prompts[0].text, "Alpha paragraph");
  assert.equal(delivered.prompts[0].comment_id, located.comment_id);
  assert.equal(delivered.prompts[0].round_id, located.round_id);
});

test("completing one comment leaves another pending and preserves completion across store reload", async (t) => {
  const { store, key } = await fixture(t);
  const a = anchored("review-isolation-a"),
    b = anchored("review-isolation-b", "comment-beta", "beta");
  await queue(store, key, [a, b]);
  await replyNext(store, key, "Alpha reply");
  await replyNext(store, key, "Beta reply");
  const before = await store.feedbackSnapshot(key);
  const bBefore = message(before, b.prompt_id);
  await store.completeFeedback(key, await completion(store, key, a));
  const after = await new SessionStore(store.file).feedbackSnapshot(key);
  assert.equal(message(after, a.prompt_id).resolved, true);
  assert.deepEqual(message(after, b.prompt_id), bBefore, "completion must not alter another comment or its reply");
  assert.equal(message(after, b.prompt_id).resolved, false);
  assert.equal(after.lifecycle, "open", "one comment completion does not end communication");
});

test("follow-up accepted first rejects completion of the older round", async (t) => {
  const { store, key } = await fixture(t);
  const old = anchored("review-old-round"),
    next = anchored("review-new-round", old.comment_id);
  await queue(store, key, [old]);
  await replyNext(store, key);
  const staleCompletion = await completion(store, key, old);
  await queue(store, key, [next]);
  await assert.rejects(store.completeFeedback(key, staleCompletion), /ROUND|STALE|CONFLICT/);
  const after = await store.feedbackSnapshot(key);
  assert.equal(message(after, old.prompt_id).resolved, false);
  assert.equal(message(after, next.prompt_id).resolved, false);
  assert.equal(message(after, next.prompt_id).state, "accepted");
});

test("completion validates loaded reply and artifact revisions; exact completed retry is idempotent", async (t) => {
  const { store, key } = await fixture(t);
  const a = anchored("review-complete-retry");
  await queue(store, key, [a]);
  await replyNext(store, key);
  const request = await completion(store, key, a);
  await assert.rejects(
    store.completeFeedback(key, { ...request, reply_version: request.reply_version + 1 }),
    /REPLY|STALE|CONFLICT/,
  );
  await assert.rejects(
    store.completeFeedback(key, { ...request, artifact_revision: request.artifact_revision + 1 }),
    /REVISION|STALE|CONFLICT/,
  );
  assert.equal(message(await store.feedbackSnapshot(key), a.prompt_id).resolved, false);
  await store.completeFeedback(key, request);
  const first = message(await store.feedbackSnapshot(key), a.prompt_id);
  await store.completeFeedback(key, request);
  assert.deepEqual(message(await store.feedbackSnapshot(key), a.prompt_id), first);
  assert.equal(first.resolved, true);
});

test("completion accepted first permits a new unresolved round without erasing completed history", async (t) => {
  const { store, key } = await fixture(t);
  const old = anchored("review-done-first"),
    next = anchored("review-follow-up", old.comment_id);
  await queue(store, key, [old]);
  await replyNext(store, key);
  const request = await completion(store, key, old);
  await store.completeFeedback(key, request);
  await queue(store, key, [next]);
  const after = await store.feedbackSnapshot(key);
  assert.equal(message(after, old.prompt_id).resolved, true);
  assert.equal(message(after, next.prompt_id).resolved, false);
  assert.equal(message(after, next.prompt_id).prompt.round_id, next.round_id);
  assert.notEqual(old.round_id, next.round_id);
  await assert.rejects(store.completeFeedback(key, request), /ROUND|STALE|CONFLICT/);
});

test("ended review requires explicit reopen; new epoch rejects old submit and receipt while preserving history", async (t) => {
  const { store, key, binding } = await fixture(t);
  const old = sessionPrompt("review-before-reopen");
  await queue(store, key, [old]);
  const { proof } = await replyNext(store, key, "Original review reply");
  await store.beginFeedbackEnd(key, { id: "review-end", epoch: 1, final: null });
  const marker = await take(store, key);
  await store.reconcileFeedback(key, consumed(marker.delivery));
  const ended = await store.feedbackSnapshot(key);
  assert.equal(ended.lifecycle, "ended");
  await assert.rejects(store.upsertSession(binding.artifact, "http://127.0.0.1:49793/"), /REOPEN|REVIEW/);
  await store.reopenFeedback(key, binding);
  const reopened = await store.feedbackSnapshot(key);
  assert.equal(reopened.epoch, 2);
  assert.equal(reopened.lifecycle, "open");
  assert.ok(reopened.version > ended.version, "reopen keeps the global state version monotonic");
  assert.deepEqual(reopened.messages, []);
  assert.ok(reopened.history.some((entry) => entry.epoch === 1 && entry.messages.some((m) => m.id === old.prompt_id)));
  await assert.rejects(queue(store, key, [sessionPrompt("review-stale-submit")], 1), /EPOCH/);
  await assert.rejects(store.reconcileFeedback(key, { ...proof, kind: "consumed" }), /EPOCH|IDENTITY/);
  await store.reconcileFeedback(key, proof);
  assert.equal(
    (await store.feedbackSnapshot(key)).version,
    reopened.version,
    "archived reply cannot change active review",
  );
  assert.deepEqual((await store.feedbackSnapshot(key)).messages, []);
  const next = sessionPrompt("review-after-reopen");
  await queue(store, key, [next], 2);
  const delivered = await take(store, key);
  assert.equal(delivered.delivery.epoch, 2);
  assert.equal(delivered.delivery.id, next.prompt_id);
});

test("confirm end retries the original sealed request after response loss without duplicating final or marker", async (t) => {
  const { store, key } = await fixture(t);
  const loaded = await loadReviewedArtifact(store, key);
  const before = await store.feedbackSnapshot(key);
  const request = {
    id: "review-confirm-lost-response",
    epoch: before.epoch,
    confirm: true,
    state_version: before.version,
    artifact_revision: before.artifact_revision,
    ...loaded,
    final: { id: "review-confirm-final", epoch: before.epoch, text: "I confirm this complete page" },
  };
  await store.beginFeedbackEnd(key, request);
  const accepted = await store.feedbackSnapshot(key);
  assert.equal(accepted.lifecycle, "ending");
  assert.ok(
    accepted.version > request.state_version,
    "first success advances server state before its response is lost",
  );
  assert.deepEqual(
    accepted.messages.map((m) => m.id),
    [request.final.id, request.id + "-marker"],
  );

  const reloaded = new SessionStore(store.file);
  await reloaded.beginFeedbackEnd(key, structuredClone(request));
  const retried = await reloaded.feedbackSnapshot(key);
  assert.deepEqual(retried.messages, accepted.messages, "retry must not append or modify the sealed batch");
  assert.deepEqual(retried.end, accepted.end);
  for (const id of [request.final.id, request.id + "-marker"]) {
    const item = await take(reloaded, key);
    assert.equal(item.delivery.id, id);
    await reloaded.reconcileFeedback(key, consumed(item.delivery));
  }
  const ended = await reloaded.feedbackSnapshot(key);
  assert.equal(ended.lifecycle, "ended");
  await reloaded.beginFeedbackEnd(key, structuredClone(request));
  assert.deepEqual((await reloaded.feedbackSnapshot(key)).messages, ended.messages);
});

test("confirm end retry cannot change final text under the original end identity", async (t) => {
  const { store, key } = await fixture(t);
  const loaded = await loadReviewedArtifact(store, key);
  const before = await store.feedbackSnapshot(key);
  const request = {
    id: "review-confirm-sealed",
    epoch: before.epoch,
    confirm: true,
    state_version: before.version,
    artifact_revision: before.artifact_revision,
    ...loaded,
    final: { id: "review-sealed-final", epoch: before.epoch, text: "Original final feedback" },
  };
  await store.beginFeedbackEnd(key, request);
  const accepted = await store.feedbackSnapshot(key);
  await assert.rejects(
    store.beginFeedbackEnd(key, { ...request, final: { ...request.final, text: "Changed final feedback" } }),
    /CONFLICT|STALE_REVIEW/,
  );
  assert.deepEqual((await store.feedbackSnapshot(key)).messages, accepted.messages);
});

test("review artifact record requires an actual active load token and refuses a superseded token", async (t) => {
  const { store, key } = await fixture(t);
  const html = await readFile((await store.findByKey(key)).file, "utf8");
  await assert.rejects(store.recordReviewArtifact(key, undefined, html), /ARTIFACT|TOKEN|LOAD/);
  await assert.rejects(store.recordReviewArtifact(key, "invented-load-token", html), /ARTIFACT|TOKEN|LOAD/);
  const first = await loadReviewedArtifact(store, key);
  const second = await loadReviewedArtifact(store, key);
  assert.notEqual(first.artifact_load_token, second.artifact_load_token);
  assert.equal(
    first.artifact_digest,
    second.artifact_digest,
    "same bytes keep the digest while the load token changes",
  );
  await assert.rejects(store.recordReviewArtifact(key, first.artifact_load_token, html), /STALE_ARTIFACT|TOKEN|LOAD/);
  const after = await store.feedbackSnapshot(key);
  assert.equal(after.artifact_load_token, second.artifact_load_token);
  assert.equal(after.artifact_digest, second.artifact_digest);
});

test("unchanged artifact revision cannot authorize completion after the actual HTML bytes changed", async (t) => {
  const { store, key } = await fixture(t);
  const p = anchored("review-artifact-bytes");
  await queue(store, key, [p]);
  await replyNext(store, key);
  const loaded = await loadReviewedArtifact(store, key);
  const oldPageRequest = { ...(await completion(store, key, p)), ...loaded };
  const session = await store.findByKey(key);
  await writeFile(session.file, '<!doctype html><p id="alpha">Changed after this page was loaded</p>');
  assert.equal(
    (await store.findByKey(key)).artifact_revision,
    oldPageRequest.artifact_revision,
    "this fixture changes disk bytes without a new load or revision event",
  );
  await assert.rejects(store.completeFeedback(key, oldPageRequest), /STALE_ARTIFACT/);
  assert.equal(message(await store.feedbackSnapshot(key), p.prompt_id).resolved, false);
  const freshLoad = await loadReviewedArtifact(store, key);
  assert.notEqual(freshLoad.artifact_digest, loaded.artifact_digest);
  await store.completeFeedback(key, { ...(await completion(store, key, p)), ...freshLoad });
  assert.equal(message(await store.feedbackSnapshot(key), p.prompt_id).resolved, true);
});

test("completion rejects stale page token and forged digest even when reply and revision otherwise match", async (t) => {
  const { store, key } = await fixture(t);
  const p = anchored("review-artifact-token");
  await queue(store, key, [p]);
  await replyNext(store, key);
  const oldPage = await loadReviewedArtifact(store, key);
  const currentPage = await loadReviewedArtifact(store, key);
  const current = { ...(await completion(store, key, p)), ...currentPage };
  await assert.rejects(
    store.completeFeedback(key, { ...current, artifact_load_token: oldPage.artifact_load_token }),
    /STALE_ARTIFACT/,
  );
  await assert.rejects(store.completeFeedback(key, { ...current, artifact_digest: "0".repeat(64) }), /STALE_ARTIFACT/);
  await assert.rejects(store.completeFeedback(key, { ...current, artifact_digest: undefined }), /STALE_ARTIFACT/);
  assert.equal(message(await store.feedbackSnapshot(key), p.prompt_id).resolved, false);
  await store.completeFeedback(key, current);
  assert.equal(message(await store.feedbackSnapshot(key), p.prompt_id).resolved, true);
});

test("feedback arriving after a waiting take but before pump cleanup must not lose its wakeup", async (t) => {
  const { store, key, binding } = await fixture(t);
  const events = new EventEmitter(),
    deliveries = [];
  const host = {
    instance: binding.instance,
    session: binding.session,
    setReceiver() {},
    async deliver(_message, claim) {
      deliveries.push(claim.id);
      return { ...claim, kind: "queued", evidenceId: `queued-${claim.id}` };
    },
    async query() {
      return null;
    },
  };
  const review = createPolishReview({ store, events, host });
  const originalTake = store.takeFeedback.bind(store);
  let releaseWaiting = () => {},
    reportWaiting = () => {},
    held = false;
  const waitingTaken = new Promise((resolve) => {
    reportWaiting = () => resolve(undefined);
  });
  const release = new Promise((resolve) => {
    releaseWaiting = () => resolve(undefined);
  });
  store.takeFeedback = async (sessionKey, lease = null) => {
    const result = await originalTake(sessionKey, lease);
    if (result.status === "waiting" && !held) {
      held = true;
      reportWaiting();
      // Store lock is already released: model the async completion gap before pump finally.
      await release;
    }
    return result;
  };
  try {
    const firstPump = review.pump(key);
    await waitingTaken;
    const p = sessionPrompt("review-wakeup-gap");
    await queue(store, key, [p]);
    const published = new Promise((resolve) => events.once("polish-review", resolve));
    events.emit("feedback", key);
    await published;
    await new Promise((resolve) => setImmediate(resolve));
    releaseWaiting();
    await firstPump;
    const deadline = Date.now() + 500;
    while (deliveries.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(
      deliveries,
      [p.prompt_id],
      "the accepted message must drain from its original event, without another submit/reopen",
    );
    await review.pump(key);
    assert.equal(message(await store.feedbackSnapshot(key), p.prompt_id).state, "host_queued");
  } finally {
    releaseWaiting();
    store.takeFeedback = originalTake;
    review.close();
  }
});

test("Pi host rejects old binding after the live session manager switches conversations", async (t) => {
  const { store, binding } = await fixture(t);
  let currentSession = binding.session;
  const sent = [];
  const pi = {
    on() {
      return () => {};
    },
    sendMessage(payload) {
      sent.push(payload);
    },
  };
  const ctx = {
    sessionManager: { getSessionId: () => currentSession, getBranch: () => [] },
    isIdle: () => true,
    hasPendingMessages: () => false,
    ui: { notify() {} },
  };
  const host = await createPiHost(pi, ctx, path.join(path.dirname(store.file), "pi-host"));
  try {
    const text = "Feedback owned by the original Pi conversation";
    const claim = {
      artifact: binding.artifact,
      instance: host.instance,
      session: host.session,
      epoch: 1,
      id: "review-session-switched",
      attempt: randomUUID(),
      digest: createHash("sha256").update(text).digest("hex"),
      generation: 1,
      mode: "bridge",
    };
    currentSession = "different-live-session";
    await assert.rejects(
      host.deliver({ text, prompt: sessionPrompt(claim.id), kind: "message" }, claim),
      /SESSION|BINDING|IDENTITY/,
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(sent, [], "old review feedback must not be sent into the new live conversation");
  } finally {
    host.close();
  }
});

test("late precise reply after ended is archived without broadcasting or waking communication", async (t) => {
  const { store, key, binding } = await fixture(t);
  const events = new EventEmitter(),
    broadcasts = [],
    deliveries = [];
  let receiver = async (_key, _proof) => {
    throw new Error("Review must register the host receiver before delivery");
  };
  for (const name of ["polish-review", "ended", "feedback"]) {
    events.on(name, (...args) => broadcasts.push({ name, args }));
  }
  const host = {
    instance: binding.instance,
    session: binding.session,
    setReceiver(fn) {
      receiver = fn;
    },
    async deliver(item, claim) {
      deliveries.push({ item, claim });
      return { ...claim, kind: "queued", evidenceId: `queued-${claim.id}` };
    },
    async query() {
      return null;
    },
  };
  const review = createPolishReview({ store, events, host });
  t.after(() => review.close());
  const p = sessionPrompt("review-late-reply");
  await queue(store, key, [p]);
  await review.pump(key);
  assert.equal(deliveries.length, 1);
  const first = deliveries[0];
  await receiver(key, consumed(first.claim));
  await new Promise((resolve) => setImmediate(resolve));
  await review.pump(key);
  await store.beginFeedbackEnd(key, { id: "review-late-end", epoch: 1, final: null });
  await review.pump(key);
  assert.equal(deliveries.length, 2);
  await receiver(key, consumed(deliveries[1].claim));
  await new Promise((resolve) => setImmediate(resolve));
  await review.pump(key);
  assert.equal((await store.feedbackSnapshot(key)).lifecycle, "ended");
  assert.ok(
    broadcasts.some((event) => event.name === "ended"),
    "the actual end transition is published once",
  );
  broadcasts.length = 0;

  await receiver(key, {
    ...consumed(first.claim),
    kind: "reply",
    evidenceId: "reply-after-end",
    replyTo: p.prompt_id,
    round_id: p.round_id,
    text: "A precise reply arrived after communication ended",
  });
  await new Promise((resolve) => setImmediate(resolve));
  const archived = await new SessionStore(store.file).feedbackSnapshot(key);
  assert.equal(archived.lifecycle, "ended");
  assert.equal(message(archived, p.prompt_id).reply.text, "A precise reply arrived after communication ended");
  assert.equal(deliveries.length, 2, "late replies must not deliver another message or marker");
  assert.deepEqual(broadcasts, [], "archival after ended must not publish review, ended, or feedback events");
});

test("late precise reply after reopen stays in its historical epoch without changing active review", async (t) => {
  const { store, key, binding } = await fixture(t);
  const events = new EventEmitter(),
    broadcasts = [],
    deliveries = [];
  let receiver = async (_key, _proof) => {
    throw new Error("Review must register the host receiver before delivery");
  };
  for (const name of ["polish-review", "ended", "feedback"]) {
    events.on(name, (...args) => broadcasts.push({ name, args }));
  }
  const host = {
    instance: binding.instance,
    session: binding.session,
    setReceiver(fn) {
      receiver = fn;
    },
    async deliver(item, claim) {
      deliveries.push({ item, claim });
      return { ...claim, kind: "queued", evidenceId: `queued-${claim.id}` };
    },
    async query() {
      return null;
    },
  };
  const review = createPolishReview({ store, events, host });
  t.after(() => review.close());
  const p = sessionPrompt("review-late-reply");
  await queue(store, key, [p]);
  await review.pump(key);
  assert.equal(deliveries.length, 1);
  const first = deliveries[0];
  await receiver(key, consumed(first.claim));
  await new Promise((resolve) => setImmediate(resolve));
  await review.pump(key);
  await store.beginFeedbackEnd(key, { id: "review-late-end", epoch: 1, final: null });
  await review.pump(key);
  assert.equal(deliveries.length, 2);
  await receiver(key, consumed(deliveries[1].claim));
  await new Promise((resolve) => setImmediate(resolve));
  await review.pump(key);
  assert.equal((await store.feedbackSnapshot(key)).lifecycle, "ended");
  assert.ok(
    broadcasts.some((event) => event.name === "ended"),
    "the actual end transition is published once",
  );
  await store.reopenFeedback(key, binding);
  const beforeLate = await store.feedbackSnapshot(key);
  broadcasts.length = 0;

  await receiver(key, {
    ...consumed(first.claim),
    kind: "reply",
    evidenceId: "reply-after-end",
    replyTo: p.prompt_id,
    round_id: p.round_id,
    text: "A precise reply arrived after communication ended",
  });
  await new Promise((resolve) => setImmediate(resolve));
  const archived = await new SessionStore(store.file).feedbackSnapshot(key);
  assert.equal(archived.lifecycle, "open");
  assert.equal(archived.epoch, 2);
  assert.equal(archived.version, beforeLate.version);
  assert.deepEqual(archived.messages, []);
  assert.equal(
    message(archived.history[0], p.prompt_id).reply.text,
    "A precise reply arrived after communication ended",
  );
  assert.equal(deliveries.length, 2, "late replies must not deliver another message or marker");
  assert.deepEqual(broadcasts, [], "archival after ended must not publish review, ended, or feedback events");
});

test("verified model failure settles processing but never fabricates a successful reply", async (t) => {
  const { store, key } = await fixture(t);
  const p = sessionPrompt("review-model-failure");
  await queue(store, key, [p]);
  const item = await take(store, key);
  const proof = { ...consumed(item.delivery), kind: "failed", error: "Provider unavailable" };
  await assert.rejects(store.reconcileFeedback(key, { ...proof, inputEvidence: undefined }), /EVIDENCE/);
  await store.reconcileFeedback(key, proof);
  const failed = message(await store.feedbackSnapshot(key), p.prompt_id);
  assert.equal(failed.state, "failed");
  assert.equal(failed.consumed, true);
  assert.equal(failed.reply, undefined);
  assert.equal(failed.execution_error, "Provider unavailable");
  await queue(store, key, [sessionPrompt("review-after-failure")]);
  assert.equal((await take(store, key)).delivery.id, "review-after-failure");
});
