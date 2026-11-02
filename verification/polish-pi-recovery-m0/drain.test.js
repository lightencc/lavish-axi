import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Authority, Replica } from './authority.js';
import { drainAccepted } from './drain.js';
const binding = { artifact: 'a', instance: 'i', session: 's' };
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'polish-drain-')); const a = new Authority(dir, binding);
  t.after(() => { a.close(); rmSync(dir, { recursive: true, force: true }); });
  return a;
}
// All adapters in this file are explicit host doubles.
const receipt = (r, token, kind) => ({ ...binding, id: r.id, epoch: r.epoch, attempt: token.attempt, digest: r.digest, kind, evidenceId: 'fake-' + r.id, inputEvidence: 'context_with_system' });
test('drainer consumes the fixed final batch and marker with no connected client', async t => {
  const a = fixture(t); a.admit({ id: 'r1-first', text: 'first', epoch: 1 });
  a.beginEnd({ id: 'end-one', epoch: 1, final: { id: 'r1-final', text: 'final', epoch: 1 } });
  const order = [];
  await drainAccepted(a, async (r, token) => { order.push(r.id); assert.equal(a.snapshot().lifecycle, 'ending'); return receipt(r, token, 'consumed'); });
  assert.deepEqual(order, ['r1-first', 'r1-final', 'end-one-marker']); assert.equal(a.snapshot().lifecycle, 'ended');
});
test('queue acknowledgement cannot end or dispatch the marker early', async t => {
  const a = fixture(t); a.admit({ id: 'r1-first', text: 'first', epoch: 1 }); a.beginEnd({ id: 'end-one', epoch: 1, final: null });
  let calls = 0;
  await drainAccepted(a, async (r, token) => { calls++; return receipt(r, token, 'queued'); });
  await drainAccepted(a, async () => { calls++; throw new Error('must not retry'); });
  assert.equal(calls, 1); assert.equal(a.snapshot().lifecycle, 'ending'); assert.equal(a.snapshot().messages[1].state, 'accepted');
});
test('uncertain adapter call stops drain and is never automatically retried', async t => {
  const a = fixture(t); a.beginEnd({ id: 'end-one', epoch: 1, final: null }); let calls = 0;
  const adapter = async () => { calls++; throw new Error('simulated lost host receipt'); };
  await drainAccepted(a, adapter); await drainAccepted(a, adapter);
  assert.equal(calls, 1); assert.equal(a.snapshot().messages[0].state, 'unknown'); assert.equal(a.snapshot().lifecycle, 'ending');
});
test('subscription failure cannot erase committed end event; reconnect snapshot recovers it', async t => {
  const a = fixture(t); a.subscribe(() => { throw new Error('disconnected transport'); });
  a.beginEnd({ id: 'end-one', epoch: 1, final: null });
  await drainAccepted(a, async (r, token) => receipt(r, token, 'consumed'));
  const replica = new Replica(); replica.begin('new'); replica.snapshot('new', a.snapshot());
  assert.equal(replica.state.lifecycle, 'ended');
});
