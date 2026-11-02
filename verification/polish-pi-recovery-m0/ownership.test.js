import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Authority } from './authority.js';
const binding = { artifact: 'm0-artifact', instance: 'owned-pi', session: 'owned-session' };

for (const mode of ['accepted', 'dispatch', 'ending']) {
  test(`owned process crash in ${mode}: durable state and fenced recovery`, { timeout: 10000 }, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'polish-owned-'));
    const child = fork(new URL('./owner-child.js', import.meta.url), [dir, mode], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let recovered;
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); recovered?.close(); rmSync(dir, { recursive: true, force: true }); });
    const [ready] = await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error('CHILD_EARLY_EXIT'); })]);
    assert.throws(() => Authority.recoverOwned(dir, binding, child, ready.nonce), /EXIT_PROOF_REQUIRED/);
    assert.throws(() => new Authority(dir, binding), /EEXIST/);
    const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit;
    assert.throws(() => Authority.recoverOwned(dir, binding, child, 'wrong'), /OWNER_MISMATCH/);
    recovered = Authority.recoverOwned(dir, binding, child, ready.nonce);
    t.diagnostic(JSON.stringify({ evidence: 'owned-child-crash-recovery', mode, pid: child.pid, signal: child.signalCode, oldNonce: ready.nonce, before: ready.snapshot, after: recovered.snapshot(), oldToken: ready.token }));
    assert.ok(recovered.snapshot().generation > ready.snapshot.generation);
    assert.equal(recovered.snapshot().messages[0].id, ready.snapshot.messages[0].id);
    if (mode === 'dispatch') {
      assert.equal(recovered.snapshot().messages[0].state, 'unknown');
      assert.throws(() => recovered.claim('bridge', ready.token.id), /NOT_ACCEPTED/);
      assert.throws(() => recovered.record(ready.token, {}), /STALE/);
      assert.throws(() => recovered.switchMode('poll'), /UNSETTLED/);
    } else {
      assert.equal(recovered.snapshot().messages[0].state, 'accepted');
      assert.ok(recovered.claim('bridge', ready.snapshot.messages[0].id).attempt);
    }
    if (mode === 'ending') {
      assert.equal(recovered.snapshot().lifecycle, 'ending');
      assert.deepEqual(recovered.snapshot().end, ready.snapshot.end);
    }
  });
}

test('two real consumer processes use one persisted arbitration authority', { timeout: 10000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'polish-consumers-')); const a = new Authority(dir, binding);
  a.admit({ id: 'r1-race', text: 'local arbitration fixture', epoch: 1 });
  const children = [], results = [];
  t.after(() => { for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); a.close(); rmSync(dir, { recursive: true, force: true }); });
  await Promise.all(['bridge', 'poll'].map(mode => new Promise((resolve, reject) => {
    const child = fork(new URL('./owner-child.js', import.meta.url), [dir, 'consumer', mode], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }); children.push(child);
    child.on('error', reject);
    child.on('message', request => {
      if (request.kind === 'claim') {
        try { const token = a.claim(request.mode, 'r1-race'); results.push({ mode, granted: true, token }); child.send({ ok: true }); }
        catch (error) { results.push({ mode, granted: false, error: error.message }); child.send({ ok: false }); }
      }
    });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error('CONSUMER_EXIT')));
  })));
  assert.equal(results.filter(x => x.granted).length, 1);
  assert.equal(results.find(x => x.granted).mode, 'bridge');
  assert.equal(a.snapshot().messages[0].state, 'dispatching');
  t.diagnostic(JSON.stringify({ evidence: 'shared-arbitration', pids: children.map(c => c.pid), results, snapshot: a.snapshot() }));
});
