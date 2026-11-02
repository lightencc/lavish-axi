import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionStore } from "../src/session-store.js";

async function fixture(t, inputEvidence = undefined) {
  const dir = await mkdtemp(path.join(tmpdir(), "polish-delivery-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "fixture.html");
  await writeFile(file, "<!doctype html><p>Isolated review</p>");
  const store = new SessionStore(path.join(dir, "state.json"));
  const session = await store.upsertSession(file, "http://127.0.0.1:49793/");
  const binding = {
    artifact: session.file,
    instance: "owned-pi",
    session: "owned-session",
    ...(inputEvidence ? { inputEvidence } : {}),
  };
  await store.bindFeedback(session.key, binding);
  return { store, key: session.key, binding };
}
const prompt = (id, text = "Whole page feedback") => ({ prompt_id: id, prompt: text });
const proof = (delivery, kind = "consumed") => ({
  ...delivery,
  kind,
  evidenceId: "host-input",
  inputEvidence: "context_with_system",
});

test("Claude binding requires its explicit tool witness and cannot accept a Pi witness", async (t) => {
  const { store, key } = await fixture(t, "claude_channel_ack");
  await store.queuePrompts(key, { prompts: [prompt("claude-proof")] });
  const { delivery } = await store.takeFeedback(key, await store.feedbackLease(key, "bridge"));
  await assert.rejects(store.recordFeedback(key, delivery, proof(delivery)), /EVIDENCE/);
  await store.recordFeedback(key, delivery, { ...proof(delivery), inputEvidence: "claude_channel_ack" });
  assert.equal((await store.feedbackSnapshot(key)).messages[0].consumed, true);
});

test("bound take uses one persistent arbiter: mode and generation reject; response is not consumption", async (t) => {
  const { store, key } = await fixture(t);
  await store.queuePrompts(key, { prompts: [prompt("r3-first"), prompt("r3-second")] });
  await assert.rejects(store.feedbackLease(key, "poll"), /MODE/);
  const lease = await store.feedbackLease(key, "bridge");
  const [first, race] = await Promise.all([store.takeFeedback(key, lease), store.takeFeedback(key, lease)]);
  assert.equal(first.status, "feedback");
  assert.equal(race.status, "waiting");
  await store.reserveFeedbackHost(key, first.delivery);
  await assert.rejects(store.reserveFeedbackHost(key, first.delivery), /HOST_ALREADY_DISPATCHED/);
  assert.equal((await store.feedbackSnapshot(key)).messages[0].consumed, false);
  await assert.rejects(store.setFeedbackMode(key, "poll"), /UNSETTLED/);
  await assert.rejects(store.takeFeedback(key), /LEASE/);
  await store.recordFeedback(key, first.delivery, proof(first.delivery));
  await store.setFeedbackMode(key, "poll");
  await assert.rejects(store.takeFeedback(key, lease), /STALE/);
  await assert.rejects(store.recordFeedback(key, first.delivery, proof(first.delivery)), /STALE/);
  const second = await store.takeFeedback(key, await store.feedbackLease(key, "poll"));
  assert.equal(second.delivery.id, "r3-second");
});

test("restart preserves unknown attempt; positive query can recover but empty or mismatched evidence cannot", async (t) => {
  const { store, key } = await fixture(t);
  await store.queuePrompts(key, { prompts: [prompt("r3-lost"), prompt("r3-pending")] });
  const first = await store.takeFeedback(key, await store.feedbackLease(key, "bridge"));
  const reopened = new SessionStore(store.file);
  await reopened.recoverFeedback(key);
  const snapshot = await reopened.feedbackSnapshot(key);
  assert.equal(snapshot.messages[0].state, "unknown");
  assert.equal(snapshot.messages[1].state, "accepted");
  assert.equal((await reopened.takeFeedback(key, await reopened.feedbackLease(key, "bridge"))).status, "waiting");
  await assert.rejects(reopened.reconcileFeedback(key, { ...proof(first.delivery), attempt: "wrong" }), /IDENTITY/);
  await assert.rejects(
    reopened.reconcileFeedback(key, { ...proof(first.delivery), inputEvidence: "http-200" }),
    /EVIDENCE/,
  );
  await reopened.reconcileFeedback(key, proof(first.delivery));
  const next = await reopened.takeFeedback(key, await reopened.feedbackLease(key, "bridge"));
  assert.equal(next.delivery.id, "r3-pending");
  assert.equal((await reopened.feedbackSnapshot(key)).messages[0].claim.attempt, first.delivery.attempt);
});

test("end seals existing/final/marker; only consumption ends; delivered reply-unknown does not block", async (t) => {
  const { store, key } = await fixture(t);
  await store.queuePrompts(key, { prompts: [prompt("r3-existing")] });
  const end = { id: "r3-end", epoch: 1, final: { id: "r3-final", text: "Final feedback", epoch: 1 } };
  await store.beginFeedbackEnd(key, end);
  await store.beginFeedbackEnd(key, end);
  await assert.rejects(store.endSession(key), /BOUND_END_REQUIRES_FIXED_BATCH/);
  await assert.rejects(store.addAgentReply(key, "unassociated reply"), /BOUND_REPLY_REQUIRES_IDENTITY/);
  await assert.rejects(store.queuePrompts(key, { prompts: [prompt("r3-late")] }), /CLOSED/);
  for (const id of ["r3-existing", "r3-final", "r3-end-marker"]) {
    assert.equal((await store.feedbackSnapshot(key)).lifecycle, "ending");
    const result = await store.takeFeedback(key, await store.feedbackLease(key, "bridge"));
    assert.equal(result.delivery.id, id);
    await store.recordFeedback(key, result.delivery, proof(result.delivery));
    await store.markFeedbackUnknown(key, result.delivery);
  }
  const snapshot = await store.feedbackSnapshot(key);
  assert.equal(snapshot.lifecycle, "ended");
  assert.ok(snapshot.messages.every((m) => m.consumed && m.executionUnknown));
  assert.equal((await store.takeFeedback(key, await store.feedbackLease(key, "bridge"))).status, "ended");
});

test("same ID different payload conflicts; bound restore never bypasses dispatch ledger; legacy stays unbound", async (t) => {
  const { store, key } = await fixture(t);
  await store.queuePrompts(key, { prompts: [prompt("r3-id")] });
  await assert.rejects(store.queuePrompts(key, { prompts: [prompt("r3-id", "Changed")] }), /CONFLICT/);
  const result = await store.takeFeedback(key, await store.feedbackLease(key, "bridge"));
  await assert.rejects(store.queuePrompts(key, { prompts: result.prompts }, { restore: true }), /BOUND_RESTORE/);
  await store.markFeedbackUnknown(key, result.delivery);
  assert.equal((await store.feedbackSnapshot(key)).messages[0].state, "unknown");
});

test("late transport uncertainty cannot erase a verified reply", async (t) => {
  const { store, key } = await fixture(t);
  await store.queuePrompts(key, { prompts: [prompt("r3-replied")] });
  const result = await store.takeFeedback(key, await store.feedbackLease(key, "bridge"));
  await store.recordFeedback(key, result.delivery, proof(result.delivery, "reply"));
  await store.markFeedbackUnknown(key, result.delivery);
  const message = (await store.feedbackSnapshot(key)).messages[0];
  assert.equal(message.state, "replied");
  assert.equal(message.executionUnknown, false);
});
