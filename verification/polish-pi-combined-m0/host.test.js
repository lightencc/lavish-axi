import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { HostInbox } from './host.js';

const binding = { artifact: 'fixture.html', instance: 'owned-instance', session: 'owned-session' };
const text = 'Isolated test';
const details = { ...binding, id: 'r2-message', epoch: 1, attempt: 'owned-attempt', digest: createHash('sha256').update(text).digest('hex') };
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'polish-r2-'));
  const box = new HostInbox(dir, binding);
  t.after(() => { box.close(); rmSync(dir, { recursive: true, force: true }); });
  return box;
}
test('host admission deduplicates exact identity; wrong binding, digest, attempt and payload reject', t => {
  const box = fixture(t);
  assert.equal(box.admit({ details, text }).fresh, true);
  assert.equal(box.admit({ details, text }).fresh, false);
  for (const change of [{ instance: 'other' }, { artifact: 'other' }, { epoch: 2 }, { attempt: 'other' }, { digest: 'wrong' }]) {
    assert.throws(() => box.admit({ details: { ...details, ...change }, text }));
  }
  assert.throws(() => box.admit({ details, text: 'different' }));
  assert.equal(box.pending().length, 1);
});
test('positive query recovers durable queued fact with no history; absence is never safe to resend', t => {
  const box = fixture(t);
  assert.deepEqual(box.query(details, []), { status: 'unknown', safeToResend: false });
  box.admit({ details, text });
  assert.equal(box.query(details, []).proof.kind, 'queued');
  assert.throws(() => box.query({ ...details, attempt: 'different' }, []));
  box.dispatch(details.id);
  assert.equal(box.query(details, []).status, 'unknown');
  assert.throws(() => box.dispatch(details.id));
});
test('consumption requires full identity; query validates exact host input and reply IDs', t => {
  const box = fixture(t);
  box.admit({ details, text }); box.dispatch(details.id);
  assert.throws(() => box.consume({ ...details, epoch: 2 }, 'input-1'));
  box.consume(details, 'input-1');
  const entries = [{ id: 'input-1', type: 'custom_message', customType: 'polish-combined-input', details }];
  assert.equal(box.query(details, []).status, 'unknown');
  assert.equal(box.query(details, entries).proof.kind, 'consumed');
  box.reply(details.id, { entryId: 'reply-1', text: 'OK', stopReason: 'stop' });
  assert.equal(box.query(details, entries).proof.kind, 'consumed');
  entries.push({ id: 'reply-1', type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'OK' }], stopReason: 'stop' } });
  assert.equal(box.query(details, entries).proof.kind, 'reply');
});
