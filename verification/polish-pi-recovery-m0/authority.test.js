import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Authority, Replica } from './authority.js';

const binding = { artifact: 'm0-artifact', instance: 'owned-pi', session: 'owned-session' };
const message = (id, text = id) => ({ id, text, epoch: 1 });
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'polish-recovery-'));
  const a = new Authority(dir, binding);
  t.after(() => { a.close(); rmSync(dir, { recursive: true, force: true }); });
  return { a, dir };
}
// These receipts are test doubles, not Pi evidence.
const proof = (token, text, kind) => ({ ...binding, epoch: token.epoch, id: token.id, attempt: token.attempt, digest: createHash('sha256').update(text).digest('hex'), kind, evidenceId: 'fake-' + kind, inputEvidence: 'context_with_system' });
test('bridge and poll share arbitration; claim marks dispatch before returning', t => {
  const { a } = fixture(t); a.admit(message('r1-one'));
  const token = a.claim('bridge', 'r1-one');
  assert.equal(a.snapshot().messages[0].state, 'dispatching');
  assert.throws(() => a.claim('poll', 'r1-one'), /MODE/);
  assert.throws(() => a.claim('bridge', 'r1-one'), /NOT_ACCEPTED/);
  assert.throws(() => a.switchMode('poll'), /UNSETTLED/);
  a.record(token, proof(token, 'r1-one', 'consumed'));
  a.switchMode('poll'); a.admit(message('r1-two'));
  assert.ok(a.claim('poll', 'r1-two').generation > token.generation);
  assert.throws(() => a.record(token, proof(token, 'r1-one', 'reply')), /STALE/);
});
test('same ID is idempotent; changed payload and wrong review epoch reject', t => {
  const { a } = fixture(t); a.admit(message('r1-one')); const v = a.snapshot().version;
  a.admit(message('r1-one')); assert.equal(a.snapshot().version, v);
  assert.throws(() => a.admit(message('r1-one', 'changed')), /CONFLICT/);
  assert.throws(() => a.admit({ ...message('r1-two'), epoch: 2 }), /EPOCH/);
});
test('host queue is not consumption; unknown blocks dispatch and end', t => {
  const { a } = fixture(t); a.admit(message('r1-one')); const token = a.claim('bridge', 'r1-one');
  a.record(token, proof(token, 'r1-one', 'queued'));
  a.beginEnd({ id: 'end-one', epoch: 1, final: null });
  assert.equal(a.snapshot().lifecycle, 'ending');
  a.uncertain(token); assert.equal(a.snapshot().messages[0].state, 'unknown');
  assert.throws(() => a.claim('bridge', 'end-one-marker'), /UNSETTLED/);
  assert.throws(() => a.switchMode('poll'), /UNSETTLED/);
});
test('ending atomically seals final batch, rejects late submissions, and drains marker last', t => {
  const { a } = fixture(t); a.admit(message('r1-one'));
  const end = { id: 'end-one', epoch: 1, final: message('r1-final') };
  a.beginEnd(end); const frozen = a.snapshot().end;
  a.beginEnd(end); assert.deepEqual(a.snapshot().end, frozen);
  a.beginEnd({ final: { text: 'r1-final', epoch: 1, id: 'r1-final' }, epoch: 1, id: 'end-one' });
  assert.throws(() => a.beginEnd({ ...end, final: message('r1-final', 'changed') }), /CONFLICT/);
  assert.throws(() => a.admit(message('r1-late')), /CLOSED/);
  assert.throws(() => a.claim('bridge', 'end-one-marker'), /DRAIN_ORDER/);
  for (const id of ['r1-one', 'r1-final']) {
    const token = a.claim('bridge', id); a.record(token, proof(token, id, 'consumed'));
    assert.equal(a.snapshot().lifecycle, 'ending');
  }
  const marker = a.snapshot().messages.find(m => m.kind === 'end');
  const token = a.claim('bridge', marker.id);
  a.record(token, proof(token, marker.text, 'queued'));
  assert.equal(a.snapshot().lifecycle, 'ending');
  a.record(token, proof(token, marker.text, 'consumed'));
  assert.equal(a.snapshot().lifecycle, 'ended');
});
test('restart keeps ending set and monotonic version; old generation cannot write', t => {
  const { a, dir } = fixture(t); a.admit(message('r1-one')); a.beginEnd({ id: 'end-one', epoch: 1, final: null });
  const old = a.claim('bridge', 'r1-one'); const before = a.snapshot(); a.close();
  const b = new Authority(dir, binding);
  try {
    assert.deepEqual(b.snapshot().end, before.end); assert.ok(b.snapshot().version > before.version);
    assert.equal(b.snapshot().messages[0].state, 'unknown');
    assert.throws(() => b.record(old, proof(old, 'r1-one', 'consumed')), /STALE/);
    assert.throws(() => b.claim('bridge', 'r1-one'), /NOT_ACCEPTED/);
    // Positive trusted-adapter proof can reconcile the original attempt, without resending.
    b.reconcile(proof(old, 'r1-one', 'consumed'));
    assert.equal(b.snapshot().messages[0].state, 'delivered');
  } finally { b.close(); }
});
test('reopen advances review epoch; old replies cannot overwrite current review', t => {
  const { a } = fixture(t); a.beginEnd({ id: 'end-one', epoch: 1, final: null });
  const marker = a.snapshot().messages[0]; const token = a.claim('bridge', marker.id);
  a.record(token, proof(token, marker.text, 'consumed')); const v = a.snapshot().version;
  a.reopen(); assert.equal(a.snapshot().epoch, 2); assert.ok(a.snapshot().version > v);
  assert.throws(() => a.record(token, proof(token, marker.text, 'reply')), /EPOCH/);
  assert.throws(() => a.reconcile(proof(token, marker.text, 'reply')), /EPOCH/);
  assert.equal(a.snapshot().messages.length, 0);
});
test('wrong binding, digest and attempt never resolve an unknown request', t => {
  const { a } = fixture(t); a.admit(message('r1-one')); const token = a.claim('bridge', 'r1-one'); a.uncertain(token);
  const p = proof(token, 'r1-one', 'consumed');
  for (const patch of [{ instance: 'other' }, { digest: 'wrong' }, { attempt: 'other' }]) assert.throws(() => a.reconcile({ ...p, ...patch }), /IDENTITY/);
  assert.equal(a.snapshot().messages[0].state, 'unknown');
});
test('a receipt without an actual dispatch attempt cannot consume accepted data', t => {
  const { a } = fixture(t); const r = a.admit(message('r1-one'));
  assert.throws(() => a.reconcile({ ...binding, id: r.id, digest: r.digest, epoch: 1, kind: 'consumed', evidenceId: 'fake', inputEvidence: 'context_with_system' }), /IDENTITY/);
  assert.equal(a.snapshot().messages[0].state, 'accepted');
});
test('subscription before snapshot covers changes on either side of snapshot read', t => {
  const { a } = fixture(t); const events = []; const unsubscribe = a.subscribe(e => events.push(e));
  a.admit(message('r1-one')); const snapshot = a.snapshot(); a.admit(message('r1-two'));
  const r = new Replica(); r.begin('c1'); for (const e of events) r.event('c1', e); r.snapshot('c1', snapshot);
  assert.deepEqual(r.state, a.snapshot()); assert.equal(r.needsSnapshot, false); unsubscribe();
});
test('out of order, duplicate, stale snapshot and old connection cannot roll state back', t => {
  const { a } = fixture(t); const r = new Replica(); r.begin('c1'); r.snapshot('c1', a.snapshot());
  const events = []; const off = a.subscribe(e => events.push(e));
  a.admit(message('r1-one')); a.admit(message('r1-two'));
  r.event('c1', events[1]); assert.equal(r.needsSnapshot, true); r.event('c1', events[0]);
  r.event('c1', events[0]); assert.deepEqual(r.state, a.snapshot());
  const old = events[0].snapshot; assert.equal(r.snapshot('c1', old), false);
  r.begin('c2'); r.snapshot('c2', a.snapshot()); r.event('c1', events[0]); assert.deepEqual(r.state, a.snapshot()); off();
});
test('disconnected replica recovers reply and ended from a durable snapshot', t => {
  const { a, dir } = fixture(t); const r = new Replica(); r.begin('c1'); r.snapshot('c1', a.snapshot());
  a.admit(message('r1-one')); a.beginEnd({ id: 'end-one', epoch: 1, final: null });
  const token = a.claim('bridge', 'r1-one'); a.record(token, proof(token, 'r1-one', 'consumed')); a.record(token, proof(token, 'r1-one', 'reply'));
  const marker = a.snapshot().messages.find(m => m.kind === 'end'); const end = a.claim('bridge', marker.id); a.record(end, proof(end, marker.text, 'consumed'));
  a.close(); const b = new Authority(dir, binding);
  try { r.begin('c2'); r.snapshot('c2', b.snapshot()); assert.equal(r.state.lifecycle, 'ended'); assert.equal(r.state.messages[0].state, 'replied'); } finally { b.close(); }
});
test('new epoch requires a snapshot rather than applying its event onto old epoch', t => {
  const { a } = fixture(t); a.beginEnd({ id: 'end-one', epoch: 1, final: null });
  const marker = a.snapshot().messages[0]; const token = a.claim('bridge', marker.id); a.record(token, proof(token, marker.text, 'consumed'));
  const r = new Replica(); r.begin('c1'); r.snapshot('c1', a.snapshot()); let event;
  a.subscribe(e => { event = e; }); a.reopen(); r.event('c1', event);
  assert.equal(r.state.epoch, 1); assert.equal(r.needsSnapshot, true);
  r.begin('c2'); r.snapshot('c2', a.snapshot()); assert.equal(r.state.epoch, 2);
});
