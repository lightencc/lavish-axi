import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionStore } from "../src/session-store.js";

// Real durable review state; input/error/reply proofs are trusted adapter substitutes, not Pi evidence.
async function failedFixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "polish-retry-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "artifact.html");
  await writeFile(file, "<!doctype html><p>Pi retry fixture</p>");
  const store = new SessionStore(path.join(dir, "state.json"));
  const session = await store.upsertSession(file, "http://127.0.0.1/");
  const { key } = session;
  await store.bindFeedback(key, { artifact: session.file, instance: "retry-host", session: "retry-session" });
  const prompt = { prompt_id: "retry-message", prompt: "Revise the page", scope: "session", round_id: "retry-round" };
  await store.queuePrompts(key, { review_epoch: 1, prompts: [prompt] });
  const { delivery: claim } = await store.takeFeedback(key, await store.feedbackLease(key, "bridge"));
  await store.reserveFeedbackHost(key, claim);
  const consumed = {
    ...claim,
    kind: "consumed",
    evidenceId: "retry-input-entry",
    inputEvidence: "context_with_system",
  };
  await store.reconcileFeedback(key, consumed);
  await store.reconcileFeedback(key, {
    ...consumed,
    kind: "failed",
    evidenceId: "first-provider-error",
    error: "Temporary provider failure",
  });
  const failed = (await store.feedbackSnapshot(key)).messages[0];
  assert.equal(failed.state, "failed");
  assert.equal(failed.execution_error, "Temporary provider failure");
  return {
    store,
    key,
    claim,
    consumed,
    reply: {
      ...consumed,
      kind: "reply",
      evidenceId: "successful-retry-entry",
      replyTo: claim.id,
      round_id: prompt.round_id,
      text: "The revision succeeded after the provider retry",
    },
  };
}

test("a fresh exact input context after provider failure resumes the same claim without stale error or execution uncertainty", async (t) => {
  const { store, key, claim, consumed, reply } = await failedFixture(t);
  await store.markFeedbackUnknown(key, claim);
  assert.equal((await store.feedbackSnapshot(key)).messages[0].executionUnknown, true);
  await store.reconcileFeedback(key, consumed);
  const processing = (await store.feedbackSnapshot(key)).messages[0];
  assert.equal(processing.state, "delivered", "the new exact context witness resumes active processing");
  assert.equal(processing.consumed, true);
  assert.equal(processing.execution_error, undefined, "the previous provider failure must not mask a verified retry");
  assert.notEqual(processing.executionUnknown, true, "the live context witness supersedes prior execution uncertainty");
  assert.deepEqual(processing.claim, claim, "Pi retry does not create or redispatch a new review claim");
  await store.reconcileFeedback(key, reply);
  const persisted = (await new SessionStore(store.file).feedbackSnapshot(key)).messages[0];
  assert.equal(persisted.state, "replied");
  assert.equal(persisted.reply.text, reply.text);
  assert.equal(persisted.execution_error, undefined);
  assert.equal(persisted.executionUnknown, false);
});

test("a precise successful reply directly supersedes an earlier failed outcome and execution uncertainty", async (t) => {
  const { store, key, claim, reply } = await failedFixture(t);
  await store.markFeedbackUnknown(key, claim);
  await store.reconcileFeedback(key, reply);
  const persisted = (await new SessionStore(store.file).feedbackSnapshot(key)).messages[0];
  assert.equal(persisted.state, "replied");
  assert.equal(persisted.consumed, true);
  assert.equal(persisted.reply.reply_to, claim.id);
  assert.equal(persisted.reply.text, reply.text);
  assert.equal(
    persisted.execution_error,
    undefined,
    "a persisted successful reply must not retain UI-prioritized stale failure text",
  );
  assert.equal(persisted.executionUnknown, false);
  assert.deepEqual(persisted.claim, claim);
});
