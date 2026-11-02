import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inbox, verifyHistory } from './inbox.js';

const binding = { instance: 'test-instance', session: 'test-session' };
const message = { id: 'pi3-11111111', text: 'Isolated test' };
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'polish-pi-m0-'));
  const box = new Inbox(dir, binding);
  t.after(() => { box.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, box };
}
test('durable admission survives reopening, same payload dedups, conflict rejects', t => {
  const { dir, box } = fixture(t);
  box.admit(message); box.close();
  const reopened = new Inbox(dir, binding);
  try {
    assert.equal(reopened.get(message.id).state, 'accepted');
    assert.equal(reopened.admit(message).fresh, false);
    assert.throws(() => reopened.admit({ ...message, text: 'different' }), /CONFLICT/);
  } finally { reopened.close(); }
});
test('unresolved dispatch survives restart and cannot be claimed again', t => {
  const { dir, box } = fixture(t);
  box.admit(message); box.dispatch(message.id); box.close();
  const reopened = new Inbox(dir, binding);
  try {
    assert.equal(reopened.get(message.id).state, 'dispatching');
    assert.equal(reopened.admit(message).fresh, false);
    assert.throws(() => reopened.dispatch(message.id), /NOT_ACCEPTED/);
    assert.deepEqual(reopened.pending(), []);
  } finally { reopened.close(); }
});
test('second writer and wrong instance cannot take ownership', t => {
  const { dir, box } = fixture(t);
  assert.throws(() => new Inbox(dir, binding), /EEXIST/);
  box.close();
  assert.throws(() => new Inbox(dir, { ...binding, instance: 'other' }), /BINDING/);
});
test('empty host history never proves a dispatched message was not accepted', t => {
  const { box } = fixture(t); box.admit(message); box.dispatch(message.id);
  const result = verifyHistory(binding, box.get(message.id), []);
  assert.equal(result.delivery, 'unknown'); assert.equal(result.safeToResend, false);
});
test('structured input history is positive evidence, not proof of processing or reply', t => {
  const { box } = fixture(t); box.admit(message); box.dispatch(message.id);
  const record = box.get(message.id);
  const entry = { type: 'custom_message', id: 'input-entry', customType: 'polish-pi-m0', details: { ...binding, id: message.id, digest: record.digest } };
  const result = verifyHistory(binding, record, [entry]);
  assert.equal(result.inputStored, true); assert.equal(result.delivery, 'unknown');
  assert.equal(result.replyVerified, false); assert.equal(result.safeToResend, false);
  assert.equal(verifyHistory(binding, record, [{ ...entry, details: { ...entry.details, instance: 'other' } }]).inputStored, false);
});
test('processing evidence must match identity; reply requires persisted host entry id', t => {
  const { box } = fixture(t); box.admit(message); box.dispatch(message.id);
  const details = { ...binding, id: message.id, digest: box.get(message.id).digest };
  assert.throws(() => box.consume({ ...details, digest: 'wrong' }), /IDENTITY/);
  box.consume(details); box.reply(message.id, { entryId: 'reply-entry', text: 'done', stopReason: 'stop' });
  const record = box.get(message.id);
  const entries = [
    { type: 'custom_message', id: 'input-entry', customType: 'polish-pi-m0', details },
    { type: 'message', id: 'reply-entry', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop' } },
  ];
  assert.equal(verifyHistory(binding, record, entries).replyVerified, true);
  assert.equal(verifyHistory(binding, record, entries.slice(0, 1)).replyVerified, false);
  assert.throws(() => verifyHistory({ ...binding, session: 'wrong' }, record, entries), /BINDING/);
});
