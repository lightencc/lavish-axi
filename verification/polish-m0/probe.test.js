import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitJsonl, classify } from './probe-support.js';

test('JSONL preserves embedded Unicode separators and partial frames', () => {
  const first = splitJsonl('', '{"text":"a\u2028b"}\r\n{"type":');
  assert.deepEqual(first.records, [{ text: 'a\u2028b' }]);
  assert.equal(first.rest, '{"type":');
  assert.deepEqual(splitJsonl(first.rest, '"agent_settled"}\n').records, [{ type: 'agent_settled' }]);
});
test('host success or queue acknowledgement is not consumption', () => {
  for (const disposition of ['started', 'queued', 'handled']) {
    assert.equal(classify({type:'response', command:'prompt', success:true, data:{disposition}}), 'host_acceptance');
  }
  assert.equal(classify({type:'message_start', message:{role:'user'}}), 'input_observed');
  assert.equal(classify({type:'message_start', message:{role:'assistant'}}), 'assistant_started');
});
test('lost transport remains unknown, explicit rejection is distinct', () => {
  assert.equal(classify({type:'probe_transport_timeout'}), 'delivery_unknown');
  assert.equal(classify({type:'response', command:'prompt', success:false}), 'not_accepted');
});
