import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoverReply } from './receipt.js';
const binding = { artifact: 'a', instance: 'i', session: 's' };
const record = { id: 'r1-one', digest: 'hash', epoch: 1, claim: { attempt: 'attempt' } };
const details = { ...binding, id: record.id, digest: record.digest, epoch: 1, attempt: 'attempt' };
const input = { id: 'input', type: 'custom_message', customType: 'polish-recovery-input', details };
const reply = { id: 'reply', type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'reply with no sidecar association' }], stopReason: 'stop' } };
const receipt = { id: 'receipt', type: 'custom', customType: 'polish-recovery-receipt', data: { ...details, inputEntryId: 'input', replyEntryId: 'reply', inputEvidence: 'context_with_system' } };
test('persisted reply without structured receipt stays unknown despite adjacency', () => {
  const r = recoverReply(binding, record, [input, reply]); assert.equal(r.status, 'unknown'); assert.equal(r.safeToResend, false);
});
test('host receipt restores exact reply association missing from sidecar', () => {
  const r = recoverReply(binding, record, [input, reply, receipt]);
  assert.equal(r.status, 'verified_reply'); assert.equal(r.proof.evidenceId, 'receipt'); assert.equal(r.proof.replyEntryId, 'reply');
});
test('missing target, wrong identity, wrong order and ambiguous receipts never resolve', () => {
  for (const entries of [[reply, receipt], [input, receipt, reply], [input, reply, { ...receipt, data: { ...receipt.data, instance: 'other' } }], [input, reply, receipt, { ...receipt, id: 'receipt2' }]]) {
    const r = recoverReply(binding, record, entries); assert.equal(r.status, 'unknown'); assert.equal(r.safeToResend, false);
  }
});
