import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Bridge, handle } from './bridge.js';

const binding = { instance: 'i', session: 's' };
const origin = 'http://127.0.0.1:49793';
function fixture(t, command) {
  const dir = mkdtempSync(join(tmpdir(), 'polish-pi-bridge-'));
  const bridge = new Bridge(dir, binding, command);
  t.after(() => { bridge.close(); rmSync(dir, { recursive: true, force: true }); });
  return bridge;
}
const request = (body, headers = {}) => new Request(origin + '/submit', { method: 'POST', headers: { Host: '127.0.0.1:49793', Origin: origin, ...headers }, body: JSON.stringify(body) });
test('foreign origin and foreign host cannot reach the host adapter', async t => {
  let calls = 0;
  const bridge = fixture(t, async () => { calls++; });
  for (const headers of [{ Origin: 'https://evil.example' }, { Host: 'evil.example' }, { 'X-Forwarded-Host': 'evil.example' }, { Referer: 'not-a-url' }]) {
    assert.equal((await handle(request({ id: 'pi3-11111111', text: 'test' }, headers), bridge)).status, 403);
  }
  assert.equal(calls, 0);
});
test('client cannot override bound session or inject an element selector', async t => {
  let calls = 0;
  const bridge = fixture(t, async () => { calls++; });
  const res = await handle(request({ id: 'pi3-11111111', text: 'test', session: 'other', selector: 'body' }), bridge);
  assert.equal(res.status, 400); assert.equal(calls, 0);
});
test('missing host receipt preserves dispatch and duplicate performs query only', async t => {
  const ops = [];
  const bridge = fixture(t, async (op, data) => {
    ops.push(op);
    if (op === 'admit') throw new Error('RESULT_UNKNOWN');
    return { id: data.id, binding, digest: createHash('sha256').update('test').digest('hex'), state: 'accepted', safeToResend: false };
  });
  const msg = { id: 'pi3-11111111', text: 'test' };
  const first = await bridge.submit(msg);
  assert.equal(first.state, 'delivery_unknown');
  const second = await bridge.submit(msg);
  assert.equal(second.state, 'accepted'); assert.deepEqual(ops, ['admit', 'query']);
});
test('business receipt from a different instance is rejected', async t => {
  const bridge = fixture(t, async () => ({ id: 'pi3-11111111', binding: { ...binding, instance: 'other' }, hostQueued: true }));
  const result = await bridge.submit({ id: 'pi3-11111111', text: 'test' });
  assert.equal(result.state, 'delivery_unknown');
});
