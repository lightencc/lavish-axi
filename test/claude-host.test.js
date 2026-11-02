import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createClaudeHost } from "../src/claude-host.js";

async function fixture(t, notify = async (_event) => {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "polish-claude-host-"));
  const hosts = [];
  t.after(async () => {
    hosts.forEach((host) => host.close());
    await rm(dir, { recursive: true, force: true });
  });
  const events = [],
    proofs = [];
  const open = () => {
    const host = createClaudeHost({
      directory: dir,
      session: "fictional-claude-session",
      notify: async (event) => {
        events.push(event);
        await notify(event);
      },
    });
    host.setReceiver(async (key, proof) => proofs.push({ key, proof }));
    hosts.push(host);
    return host;
  };
  return { open, events, proofs };
}
function message(host, id = "one", kind = "message") {
  const text = JSON.stringify({ prompt: "Fictional feedback" });
  const claim = {
    artifact: "/tmp/fictional.html",
    instance: host.instance,
    session: host.session,
    epoch: 1,
    id,
    digest: createHash("sha256").update(text).digest("hex"),
    attempt: `attempt-${id}`,
    generation: 1,
    mode: "bridge",
  };
  return { message: { text, prompt: { comment_id: `comment-${id}`, round_id: `round-${id}` }, kind }, claim };
}
const receipt = (event) => ({ ...JSON.parse(event.meta.identity), receipt: event.meta.receipt });

test("notification success is queued; only the private exact receipt proves consumption and reply", async (t) => {
  const f = await fixture(t),
    host = f.open(),
    m = message(host);
  const admitted = await host.deliver(m.message, m.claim);
  assert.equal(admitted.kind, "queued");
  await host.flush();
  assert.equal(f.events.length, 1);
  assert.equal((await host.query(m)).kind, "queued");
  const token = receipt(f.events[0]);
  await assert.rejects(host.consume({ ...token, receipt: "forged" }), /RECEIPT/);
  await assert.rejects(host.consume({ ...token, session: "another" }), /IDENTITY/);
  await assert.rejects(host.reply({ ...token, text: "premature" }), /NOT_CONSUMED/);
  const consumed = await host.consume(token);
  assert.equal(consumed.kind, "consumed");
  assert.equal(consumed.inputEvidence, "claude_channel_ack");
  assert.equal((await host.consume(token)).evidenceId, consumed.evidenceId);
  const replied = await host.reply({ ...token, text: "Fictional result" });
  assert.equal(replied.replyTo, "one");
  assert.equal((await host.reply({ ...token, text: "Fictional result" })).evidenceId, replied.evidenceId);
  await assert.rejects(host.reply({ ...token, text: "conflicting result" }), /REPLY_CONFLICT/);
  assert.equal((await host.query(m)).text, "Fictional result");
  assert.ok(!JSON.stringify(f.proofs).includes(token.receipt));
});

test("dedup and serial delivery preserve identity across concurrent admissions", async (t) => {
  const f = await fixture(t),
    host = f.open(),
    a = message(host),
    b = message(host, "two");
  await Promise.all([
    host.deliver(a.message, a.claim),
    host.deliver(a.message, a.claim),
    host.deliver(b.message, b.claim),
  ]);
  await host.flush();
  assert.equal(f.events.length, 1);
  await assert.rejects(host.deliver(a.message, { ...a.claim, attempt: "wrong" }), /CONFLICT/);
  const token = receipt(f.events[0]);
  await host.consume(token);
  await host.flush();
  assert.equal(f.events.length, 2, "delivery serializes on consumption, not model completion");
  await host.reply({ ...token, text: "done" });
  await host.flush();
  assert.equal(f.events.length, 2);
  assert.equal(JSON.parse(f.events[1].meta.identity).id, "two");
});

test("final batch and end drain after consumption without any model replies", async (t) => {
  const f = await fixture(t),
    host = f.open();
  const a = message(host, "a"),
    b = message(host, "final"),
    end = message(host, "marker", "end");
  await host.deliver(a.message, a.claim);
  await host.flush();
  await host.deliver(b.message, b.claim);
  await host.deliver(end.message, end.claim);
  await host.flush();
  assert.equal(f.events.length, 1, "unconsumed A blocks B and marker");
  await host.consume(receipt(f.events[0]));
  await host.flush();
  assert.equal(f.events.length, 2, "B must not wait for A's reply");
  assert.equal(JSON.parse(f.events[1].meta.identity).id, "final");
  await host.consume(receipt(f.events[1]));
  await host.flush();
  assert.equal(f.events.length, 3);
  await host.consume(receipt(f.events[2]));
  for (const item of [a, b, end]) assert.equal((await host.query(item)).kind, "consumed");
});

test("dispatch uncertainty survives restart without replay; late exact receipt reconciles", async (t) => {
  const f = await fixture(t, async () => {
    throw new Error("transport lost after possible write");
  });
  const host = f.open(),
    m = message(host);
  await host.deliver(m.message, m.claim);
  await host.flush();
  assert.equal((await host.query(m)).kind, "unknown");
  host.close();
  const resumed = f.open();
  assert.equal(resumed.instance, host.instance);
  await resumed.flush();
  assert.equal(f.events.length, 1);
  assert.equal((await resumed.query(m)).kind, "unknown");
  await resumed.consume(receipt(f.events[0]));
  assert.equal((await resumed.query(m)).kind, "consumed");
});

test("ending cannot skip an unknown final batch and late receipt drains without replay", async (t) => {
  const f = await fixture(t, async (event) => {
    if (JSON.parse(event.meta.identity).id === "final") throw new Error("uncertain write");
  });
  const host = f.open(),
    a = message(host, "a"),
    b = message(host, "final"),
    end = message(host, "marker", "end");
  await host.deliver(a.message, a.claim);
  await host.flush();
  await host.consume(receipt(f.events[0]));
  await host.deliver(b.message, b.claim);
  await host.deliver(end.message, end.claim);
  await host.flush();
  assert.equal((await host.query(b)).kind, "unknown");
  assert.equal(f.events.length, 2);
  host.close();
  const resumed = f.open();
  await resumed.flush();
  assert.equal(f.events.length, 2, "unknown B and marker must not be sent on restart");
  await resumed.consume(receipt(f.events[1]));
  await resumed.flush();
  assert.equal(f.events.length, 3);
  assert.equal(f.events[2].meta.kind, "end");
});

test("consumed interruption is execution unknown, durable reply and end never replay", async (t) => {
  const f = await fixture(t),
    host = f.open(),
    m = message(host);
  await host.deliver(m.message, m.claim);
  await host.flush();
  const token = receipt(f.events[0]);
  await host.consume(token);
  host.close();
  const resumed = f.open();
  assert.equal((await resumed.query(m)).executionUnknown, true);
  await resumed.reply({ ...token, text: "late exact reply" });
  const end = message(resumed, "end-marker", "end");
  await resumed.deliver(end.message, end.claim);
  await resumed.flush();
  await resumed.consume(receipt(f.events[1]));
  resumed.close();
  const final = f.open();
  await final.flush();
  assert.equal((await final.query(m)).kind, "reply");
  assert.equal((await final.query(end)).kind, "consumed");
  assert.equal(f.events.length, 2);
});

test("exclusive ownership refuses another live host and closed host cannot mutate", async (t) => {
  const f = await fixture(t),
    host = f.open();
  assert.throws(f.open, /ALREADY_OWNED/);
  const m = message(host);
  host.close();
  await assert.rejects(host.deliver(m.message, m.claim), /CLOSED/);
});

test("end marker does not wait for a consumed input's model reply", async (t) => {
  const f = await fixture(t),
    host = f.open(),
    m = message(host),
    end = message(host, "end", "end");
  await host.deliver(m.message, m.claim);
  await host.flush();
  await host.consume(receipt(f.events[0]));
  await host.deliver(end.message, end.claim);
  await host.flush();
  assert.equal(f.events.length, 2);
  assert.equal(f.events[1].meta.kind, "end");
});

test("durably accepted but undispatched input gets its first delivery after restart", async (t) => {
  const f = await fixture(t),
    host = f.open(),
    m = message(host);
  await host.deliver(m.message, m.claim);
  host.close();
  const resumed = f.open();
  await resumed.flush();
  assert.equal(f.events.length, 1);
  assert.equal(JSON.parse(f.events[0].meta.identity).attempt, m.claim.attempt);
});

test("a lost side-ledger callback cannot erase a durable consumer acknowledgement", async (t) => {
  const f = await fixture(t),
    host = f.open(),
    m = message(host);
  await host.deliver(m.message, m.claim);
  await host.flush();
  host.setReceiver(async () => {
    throw new Error("review write unavailable");
  });
  await assert.rejects(host.consume(receipt(f.events[0])), /unavailable/);
  host.close();
  const resumed = f.open();
  const proof = await resumed.query(m);
  assert.equal(proof.kind, "consumed");
  assert.equal(proof.executionUnknown, true);
  await resumed.flush();
  assert.equal(f.events.length, 1);
});
