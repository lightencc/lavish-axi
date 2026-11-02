import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, ORIGIN } from './web.js';

const binding = { artifact: 'fixture', instance: 'test', session: 'test' };
function setup() {
  let state = { binding, epoch: 1, version: 1, lifecycle: 'open', messages: [] };
  const listeners = new Set(), calls = [];
  const coordinator = {
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
    async call(op, data) {
      calls.push({ op, data });
      if (op === 'snapshot') return structuredClone(state);
      if (op === 'admit') { state.messages.push({ ...data, state: 'accepted' }); state.version++; }
      if (op === 'end') { state.lifecycle = 'ending'; state.version++; }
      return structuredClone(state);
    },
  };
  const handler = createHandler(coordinator, async () => ({ status: 'unknown', safeToResend: false }));
  const request = (path, body, headers = {}) => handler(new Request(ORIGIN + path, body ? { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) } : { headers }));
  return { request, handler, state, calls, listeners };
}
test('whole-page submit has no anchor; origin, binding, epoch, extra fields and query methods checked', async () => {
  const f = setup();
  const body = { binding, epoch: 1, id: 'r2-test', text: 'whole-page', scope: 'session' };
  assert.equal((await f.request('/submit', { ...body, selector: 'body' })).status, 400);
  assert.equal((await f.request('/submit', body, { Origin: 'https://foreign.test' })).status, 403);
  assert.equal((await f.request('/snapshot', null, { Referer: 'https://foreign.test/' })).status, 403);
  assert.equal((await f.request('/submit', { ...body, epoch: 2 })).status, 409);
  assert.equal((await f.request('/submit', { ...body, binding: { ...binding, instance: 'other' } })).status, 409);
  assert.equal((await f.request('/submit', body)).status, 200);
  assert.deepEqual(f.calls.find(c => c.op === 'admit').data, { id: body.id, text: body.text, epoch: 1 });
  assert.equal((await f.request('/query')).status, 405);
});
test('refresh snapshot restores list; reconnect SSE starts with full state including ended and replies', async () => {
  const f = setup();
  f.state.messages.push({ id: 'r2-test', text: 'original', state: 'replied', consumed: true, claim: { nonce: 'private' } });
  f.state.lifecycle = 'ended';
  const restored = await (await f.request('/snapshot')).json();
  assert.equal(restored.messages.length, 1); assert.equal(restored.messages[0].claim, undefined);
  const response = await f.request('/events'); const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /"lifecycle":"ended"/); assert.match(first, /"state":"replied"/);
  assert.equal(f.listeners.size, 1); await reader.cancel(); assert.equal(f.listeners.size, 0);
});
test('end forwards fixed final submission, does not infer completion from no pending browser request', async () => {
  const f = setup();
  const response = await f.request('/end', { binding, epoch: 1, id: 'r2-end', final: { id: 'r2-final', text: 'confirmed', epoch: 1 } });
  assert.equal(response.status, 200); assert.equal(f.state.lifecycle, 'ending');
  assert.equal(f.calls.find(c => c.op === 'end').data.final.text, 'confirmed');
});
