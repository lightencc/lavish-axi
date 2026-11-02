// Component evidence only. No HTTP listener or browser is created here.
import { mkdirSync, appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { startPeer } from './peer.js';
import { Bridge } from './bridge.js';
import { verifyHistory } from './inbox.js';

const root = resolve('verification/polish-pi-m0');
const output = join(root, 'evidence/component-events.jsonl');
if (existsSync(output)) throw new Error('Existing evidence; no automatic rerun');
const run = join(root, 'runtime', randomUUID());
mkdirSync(join(run, 'workspace'), { recursive: true, mode: 0o700 });
const log = (kind, data) => appendFileSync(output, JSON.stringify({ at: new Date().toISOString(), kind, data }) + '\n', { mode: 0o600 });
const pause = ms => new Promise(res => setTimeout(res, ms));
const peer = startPeer(run, log); let bridge, dropId, failed;
const deadline = setTimeout(() => { log('deadline', { unknown: true }); peer.child.kill('SIGTERM'); }, 90000);
try {
  const ready = await peer.ready;
  // Create a conversation before probing append-only host history persistence.
  await peer.rpc({ type: 'prompt', message: '[POLISH-PI-M0 setup] Isolated mechanism test. Reply exactly READY. No tools or other sessions.' });
  for (;;) {
    const state = await peer.rpc({ type: 'get_state' });
    if (!state.data.isStreaming) break;
    await pause(200);
  }
  const before = await peer.rpc({ type: 'get_state' });
  log('before_binding', { pid: peer.child.pid, binding: ready.binding, sessionId: before.data.sessionId, isStreaming: before.data.isStreaming, model: { provider: before.data.model.provider, id: before.data.model.id }, thinkingLevel: before.data.thinkingLevel });
  assert.equal(before.data.sessionId, ready.binding.session);
  bridge = new Bridge(join(run, 'bridge'), ready.binding, async (op, data) => {
    const result = await peer.command(op, data);
    if (op === 'admit' && data.message.id === dropId) { log('withheld_business_receipt', { id: dropId, binding: result.binding }); throw new Error('INJECTED_LOST_RECEIPT'); }
    return result;
  });
  log('bridge_bound', { binding: ready.binding, pid: peer.child.pid, transport: 'existing RPC pipes; no browser/listener' });
  const messages = Array.from({ length: 3 }, () => {
    const id = 'pi3-' + randomUUID(); return { id, text: `[POLISH-PI-M0 ${id}] Isolated test. Reply exactly ACK_${id}. No tools, files or other sessions.` };
  });
  const first = await bridge.submit(messages[0]); assert.equal(first.hostQueued, true);
  const second = await bridge.submit(messages[1]); assert.equal(second.hostQueued, true);
  log('admissions', { first, second });
  await bridge.submit(messages[0]);
  await assert.rejects(() => bridge.submit({ ...messages[0], text: 'changed' }), /CONFLICT/);
  log('duplicate_and_conflict', { id: messages[0].id, duplicateUsesQueryOnly: true, alteredPayloadRejected: true });
  async function waitReply(message) {
    const start = Date.now();
    while (Date.now() - start < 30000) {
      const q = await bridge.query(message.id);
      if (q.replyVerified) {
        assert.equal(q.reply.stopReason, 'stop'); assert.equal(q.reply.text, 'ACK_' + message.id);
        log('verified_reply', q); return q;
      }
      await pause(200);
    }
    throw new Error('UNRESOLVED_REPLY:' + message.id);
  }
  const replies = [await waitReply(messages[0]), await waitReply(messages[1])];
  dropId = messages[2].id;
  const lost = await bridge.submit(messages[2]); assert.equal(lost.state, 'delivery_unknown');
  log('unknown_after_lost_receipt', lost);
  replies.push(await waitReply(messages[2]));
  const after = await peer.rpc({ type: 'get_state' });
  assert.equal(after.data.sessionId, before.data.sessionId);
  const snapshot = { binding: ready.binding, originalPid: peer.child.pid, sameLiveInstance: true, webVerified: false, messages: messages.map(({ id }) => id), replies, sessionFile: ready.sessionFile, run };
  writeFileSync(join(root, 'evidence/component-summary.json'), JSON.stringify(snapshot, null, 2) + '\n');
  log('same_instance_after', { pid: peer.child.pid, sessionId: after.data.sessionId });
} catch (error) { failed = error; log('failure', { error: error.message }); process.exitCode = 1; }
finally {
  bridge?.close(); peer.child.stdin.end();
  const cleanup = setTimeout(() => peer.child.kill('SIGTERM'), 1500);
  await peer.exited; clearTimeout(cleanup); clearTimeout(deadline);
}
if (!failed) {
  const summary = JSON.parse(readFileSync(join(root, 'evidence/component-summary.json'), 'utf8'));
  const host = JSON.parse(readFileSync(join(run, 'host/inbox.json'), 'utf8'));
  const entries = readFileSync(summary.sessionFile, 'utf8').trim().split('\n').map(JSON.parse);
  const queries = host.messages.map(r => verifyHistory(summary.binding, r, entries));
  assert.equal(queries.length, 3); assert.ok(queries.every(q => q.replyVerified));
  log('post_exit_readonly_history', { queries, newHostStarted: false, replayCount: 0 });
  console.log('Pi component probe passed. Browser end-to-end NOT RUN.');
}
