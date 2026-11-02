import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createPiHost } from "../src/pi-host.js";

test("Pi host queues without consuming, witnesses exact input, and associates only the final reply", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "polish-pi-host-"));
  const handlers = new Map(),
    entries = [],
    sent = [],
    receipts = [];
  let idle = false;
  const pi = {
    on(name, fn) {
      handlers.set(name, fn);
      return () => handlers.delete(name);
    },
    sendMessage(message) {
      sent.push(message);
      entries.push({ id: "input-1", type: "custom_message", ...message });
    },
  };
  const ctx = {
    isIdle: () => idle,
    hasPendingMessages: () => false,
    sessionManager: { getSessionId: () => "session-1", getBranch: () => entries },
  };
  const host = await createPiHost(pi, ctx, dir);
  t.after(async () => {
    host.close();
    await rm(dir, { recursive: true, force: true });
  });
  host.setReceiver(async (key, proof) => receipts.push({ key, proof }));
  const text = JSON.stringify({ prompt: "Revise the page", scope: "session", round_id: "round-1" });
  const claim = {
    artifact: "/tmp/artifact.html",
    instance: host.instance,
    session: host.session,
    epoch: 1,
    generation: 1,
    mode: "bridge",
    id: "message-1",
    attempt: "attempt-1",
    digest: createHash("sha256").update(text).digest("hex"),
  };
  const message = { id: claim.id, text, prompt: JSON.parse(text), kind: "message" };
  const queued = await host.deliver(message, claim);
  assert.equal(queued.kind, "queued");
  assert.equal(sent.length, 0);
  idle = true;
  await handlers.get("agent_settled")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1);
  await handlers.get("context_with_system")({ messages: [{ role: "custom", ...sent[0] }] });
  assert.equal(receipts.at(-1).proof.kind, "consumed");
  const assistant = { role: "assistant", content: [{ type: "text", text: "Revised" }], stopReason: "stop" };
  entries.push({ id: "reply-1", type: "message", message: assistant });
  await handlers.get("turn_end")({ message: assistant, messageEntryId: "reply-1" });
  const proof = receipts.at(-1).proof;
  assert.equal(proof.kind, "reply");
  assert.equal(proof.replyTo, claim.id);
  assert.equal(proof.text, "Revised");
  await host.deliver(message, claim);
  assert.equal(sent.length, 1, "duplicate admission never executes twice");
  assert.equal((await host.query({ ...message, claim })).replyTo, claim.id);
});

// Real durable host admission and registered Pi hooks; only the Pi runtime boundary is fake.
async function failureFixture(t, sendError = null) {
  const dir = await mkdtemp(path.join(tmpdir(), "polish-pi-failure-"));
  const handlers = new Map(),
    entries = [],
    sent = [],
    receipts = [];
  let idle = false;
  const pi = {
    on(name, fn) {
      handlers.set(name, fn);
      return () => handlers.delete(name);
    },
    sendMessage(payload) {
      sent.push(payload);
      if (sendError) throw sendError;
      entries.push({ id: "failure-input", type: "custom_message", ...payload });
    },
  };
  const ctx = {
    isIdle: () => idle,
    hasPendingMessages: () => false,
    sessionManager: { getSessionId: () => "failure-session", getBranch: () => entries },
  };
  const host = await createPiHost(pi, ctx, dir);
  t.after(async () => {
    host.close();
    await rm(dir, { recursive: true, force: true });
  });
  host.setReceiver(async (key, proof) => receipts.push({ key, proof }));
  const text = JSON.stringify({ prompt: "Revise this page", scope: "session", round_id: "failure-round" });
  const claim = {
    artifact: "/tmp/failure-artifact.html",
    instance: host.instance,
    session: host.session,
    epoch: 1,
    generation: 1,
    mode: "bridge",
    id: "failure-message",
    attempt: "failure-attempt",
    digest: createHash("sha256").update(text).digest("hex"),
  };
  const message = { id: claim.id, text, prompt: JSON.parse(text), kind: "message" };
  assert.equal((await host.deliver(message, claim)).kind, "queued");
  assert.equal(sent.length, 0);
  idle = true;
  await handlers.get("agent_settled")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1);
  return { host, handlers, entries, sent, receipts, message, claim, dir, pi, ctx };
}

test("restart preserves consumption but exposes interrupted execution without replaying it", async (t) => {
  const f = await failureFixture(t);
  await f.handlers.get("context_with_system")({ messages: [{ role: "custom", ...f.sent[0] }] });
  assert.notEqual((await f.host.query({ ...f.message, claim: f.claim })).executionUnknown, true);
  f.host.close();
  const recovered = await createPiHost(f.pi, f.ctx, f.dir);
  try {
    const proof = await recovered.query({ ...f.message, claim: f.claim });
    assert.equal(proof.kind, "consumed");
    assert.equal(proof.executionUnknown, true);
    recovered.start();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.sent.length, 1);
  } finally {
    recovered.close();
  }
});

for (const stopReason of ["error", "aborted"]) {
  test(`Pi ${stopReason} after exact input emits a recoverable failed proof instead of leaving processing forever`, async (t) => {
    const f = await failureFixture(t);
    await f.handlers.get("context_with_system")({ messages: [{ role: "custom", ...f.sent[0] }] });
    assert.equal(f.receipts.at(-1).proof.kind, "consumed");
    const reason = stopReason === "error" ? "Provider rejected this model request" : "User aborted this model request";
    const assistant = { role: "assistant", content: [], stopReason, errorMessage: reason };
    f.entries.push({ id: "failure-assistant", type: "message", message: assistant });
    await f.handlers.get("turn_end")({ message: assistant, messageEntryId: "failure-assistant" });
    const proof = f.receipts.at(-1).proof;
    assert.equal(proof.kind, "failed");
    assert.equal(proof.id, f.claim.id);
    assert.equal(proof.attempt, f.claim.attempt);
    assert.equal(proof.inputEvidence, "context_with_system");
    assert.ok(proof.error.includes(reason), "the failure preserves the actual Pi reason");
    assert.deepEqual(await f.host.query({ ...f.message, claim: f.claim }), proof);
    await f.handlers.get("agent_settled")();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.sent.length, 1, "a failed model turn must not automatically execute again");
  });
}

test("synchronous Pi send failure reports unknown without fabricating input or retrying delivery", async (t) => {
  const f = await failureFixture(t, new Error("Pi send threw before returning"));
  assert.equal(f.receipts.length, 1, "the receiver needs an explicit uncertain outcome");
  const proof = f.receipts[0].proof;
  assert.equal(proof.kind, "unknown");
  assert.equal(proof.id, f.claim.id);
  assert.equal(proof.attempt, f.claim.attempt);
  assert.equal(proof.inputEvidence, undefined, "a send exception is not an input-consumption witness");
  assert.ok(f.receipts.every(({ proof }) => !["consumed", "reply"].includes(proof.kind)));
  assert.deepEqual(f.entries, []);
  await f.handlers.get("agent_settled")();
  f.host.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.sent.length, 1, "uncertain send must not be retried automatically");
});

async function failCurrentInput(f) {
  await f.handlers.get("context_with_system")({ messages: [{ role: "custom", ...f.sent[0] }] });
  const failure = { role: "assistant", content: [], stopReason: "error", errorMessage: "Transient provider 502" };
  f.entries.push({ id: "retry-failure", type: "message", message: failure });
  await f.handlers.get("turn_end")({ message: failure, messageEntryId: "retry-failure" });
  assert.equal(f.receipts.at(-1).proof.kind, "failed");
}

test("Pi automatic retry of the same input clears failure and publishes its later exact successful reply", async (t) => {
  const f = await failureFixture(t);
  await failCurrentInput(f);
  // Pi's retry re-enters context with the existing input; Polish does not send a new one.
  await f.handlers.get("context_with_system")({ messages: [{ role: "custom", ...f.sent[0] }] });
  assert.equal(f.receipts.at(-1).proof.kind, "consumed", "retry context must stop reporting the prior failed attempt");
  const reply = { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Recovered reply" }] };
  f.entries.push({ id: "retry-success", type: "message", message: reply });
  await f.handlers.get("turn_end")({ message: reply, messageEntryId: "retry-success" });
  const proof = f.receipts.at(-1).proof;
  assert.equal(proof.kind, "reply");
  assert.equal(proof.evidenceId, "retry-success");
  assert.equal(proof.replyTo, f.claim.id);
  assert.equal(proof.text, "Recovered reply");
  assert.deepEqual(await f.host.query({ ...f.message, claim: f.claim }), proof);
  assert.equal(f.sent.length, 1);
});

test("restarting an old host ledger with both older failure and exact newer reply recovers success without sending", async (t) => {
  const f = await failureFixture(t);
  await failCurrentInput(f);
  f.host.close();
  f.entries.push({
    id: "legacy-success",
    type: "message",
    message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Already completed" }] },
  });
  const file = path.join(f.dir, "host.json");
  const ledger = JSON.parse(await readFile(file, "utf8"));
  ledger.messages[0].state = "replied";
  ledger.messages[0].reply = { entryId: "legacy-success", text: "Already completed" };
  assert.ok(ledger.messages[0].failure, "reproduce the actual old on-disk failure-plus-reply shape");
  await writeFile(file, JSON.stringify(ledger));
  const recovered = await createPiHost(f.pi, f.ctx, f.dir);
  try {
    const proof = await recovered.query({ ...f.message, claim: f.claim });
    assert.equal(proof.kind, "reply");
    assert.equal(proof.evidenceId, "legacy-success");
    assert.equal(proof.text, "Already completed");
    recovered.start();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.sent.length, 1, "query recovery must never execute the input again");
  } finally {
    recovered.close();
  }
});

test("unverifiable successful reply records cannot hide an exact witnessed failure on restart", async (t) => {
  const f = await failureFixture(t);
  await failCurrentInput(f);
  f.host.close();
  f.entries.push({
    id: "actual-text",
    type: "message",
    message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Actual text" }] },
  });
  f.entries.unshift({
    id: "before-input",
    type: "message",
    message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Older unrelated reply" }] },
  });
  const file = path.join(f.dir, "host.json");
  const ledger = JSON.parse(await readFile(file, "utf8"));
  for (const reply of [
    { entryId: "not-in-transcript", text: "Invented reply" },
    { entryId: "actual-text", text: "Forged text" },
    { entryId: "retry-failure", text: "" },
    { entryId: "before-input", text: "Older unrelated reply" },
  ]) {
    ledger.messages[0].state = "replied";
    ledger.messages[0].reply = reply;
    await writeFile(file, JSON.stringify(ledger));
    const recovered = await createPiHost(f.pi, f.ctx, f.dir);
    try {
      const proof = await recovered.query({ ...f.message, claim: f.claim });
      assert.equal(proof.kind, "failed", `invalid reply ${reply.entryId} must not replace a witnessed failure`);
      assert.equal(proof.evidenceId, "retry-failure");
      assert.equal(proof.error, "Transient provider 502");
      recovered.start();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(f.sent.length, 1);
    } finally {
      recovered.close();
    }
  }
});
