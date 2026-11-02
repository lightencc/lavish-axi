// Actual production poll handler and SessionStore, fake HTTP boundary, real owned Pi. No TCP.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { startPeer } from './peer.js';
import { createRuntime } from './runtime.js';

const root = resolve('verification/polish-pi-prewindow-m0'), run = join(root, 'runtime', randomUUID());
const evidencePrefix = process.argv.includes('--final') ? 'pi-poll-final' : 'pi-poll';
mkdirSync(join(run, 'workspace'), { recursive: true, mode: 0o700 });
writeFileSync(join(run, 'fixture.html'), '<!doctype html><p>Isolated r3 fixture</p>');
const logPath = join(root, 'evidence', evidencePrefix + '-events.jsonl'); writeFileSync(logPath, '', { flag: 'wx' });
const log = (kind, data) => appendFileSync(logPath, JSON.stringify({ at: Date.now(), kind, data }) + '\n');
let runtime, binding, state, lostId, fault;
const admissions = new Map();
const peer = startPeer(run, (kind, data) => {
  log(kind, data);
  if (kind === 'host' && data.kind === 'proof' && data.result.proof) runtime.call('reconcile', data.result.proof).catch(error => { fault = error.message; });
  if (kind === 'host' && data.kind === 'fatal') fault = data.error;
});
async function waitFor(fn) {
  const until = Date.now() + 45000;
  while (!fn()) { if (fault || Date.now() > until) throw new Error(fault || 'TIMEOUT'); await new Promise(r => setTimeout(r, 20)); }
}
async function poll() {
  const req = Object.assign(new EventEmitter(), { query: { file: binding.artifact, timeoutMs: '1' }, method: 'GET', headers: {}, get() {}, aborted: false, destroyed: false });
  const res = Object.assign(new EventEmitter(), { writableEnded: false, json(data) { this.value = data; this.writableEnded = true; }, status() { return this; }, type() { return this; }, set() { return this; }, write() {}, end(data) { this.json(JSON.parse(data)); } });
  let error; await runtime.pollHandler(req, res, e => { error = e; }); if (error) throw error;
  return res.value;
}
const fresh = label => ({ id: 'r3-' + randomUUID(), epoch: 1, text: `[POLISH-M0-R3 ${label}] Isolated transport test. Reply exactly R3_ACK. No tools, file changes or other sessions.` });
const result = { version: 'r3', transport: 'actual handlePoll/takeFeedback; in-memory HTTP boundary; real Pi RPC', runtime: run, historicalReplays: 0 };
const deadline = setTimeout(() => { fault = 'RUN_DEADLINE'; peer.child.kill('SIGTERM'); }, 150000);
try {
  const ready = await peer.ready; binding = ready.binding; result.ready = ready;
  runtime = await createRuntime(run, binding, async (message, token) => {
    admissions.set(message.id, (admissions.get(message.id) || 0) + 1);
    const details = { ...binding, id: message.id, digest: message.digest, epoch: message.epoch, attempt: token.attempt };
    const value = await peer.command('admit', { message: { details, text: message.text } });
    log('host-admitted', { id: message.id, value });
    if (message.id === lostId) throw new Error('INJECTED_LOST_RECEIPT');
    if (!value.proof) throw new Error('UNKNOWN'); return value.proof;
  }, log);
  runtime.subscribe(e => { state = e.snapshot; });
  await assert.rejects(poll(), /MODE/);
  const oldBridgeLease = await runtime.store.feedbackLease(runtime.key, 'bridge');
  await runtime.call('mode', { mode: 'poll' });
  const first = fresh('native-poll'); await runtime.call('admit', first);
  const response = await poll(); result.pollResponse = response;
  assert.equal(response.delivery.id, first.id);
  result.afterHttpWrite = await runtime.snapshot();
  assert.equal(result.afterHttpWrite.messages[0].consumed, false);
  await assert.rejects(runtime.store.takeFeedback(runtime.key, oldBridgeLease), /STALE/);
  await peer.command('pause', { value: false });
  await runtime.deliver(response);
  await assert.rejects(runtime.deliver(response), /STALE|HOST_ALREADY/);
  await waitFor(() => state.messages.find(m => m.id === first.id)?.state === 'replied');
  result.afterPollConsumed = structuredClone(state);

  await runtime.call('mode', { mode: 'bridge' });
  await peer.command('pause', { value: true });
  const lost = fresh('lost-host-receipt'); lostId = lost.id;
  await runtime.call('admit', lost); result.unknown = structuredClone(state);
  assert.equal(state.messages.find(m => m.id === lost.id).state, 'unknown');
  const original = state.messages.find(m => m.id === lost.id).claim;
  await runtime.call('recover');
  await assert.rejects(runtime.store.recordFeedback(runtime.key, original, { ...original, kind: 'consumed', inputEvidence: 'context_with_system', evidenceId: 'not-used' }), /STALE/);
  const queried = await peer.command('query', { details: original });
  assert.equal(queried.proof.kind, 'queued'); result.queried = queried;
  await runtime.call('reconcile', queried.proof); lostId = undefined;
  await peer.command('pause', { value: false });
  await waitFor(() => state.messages.find(m => m.id === lost.id)?.state === 'replied');
  assert.equal(admissions.get(lost.id), 1);

  await peer.command('pause', { value: true });
  const end = { id: 'r3-' + randomUUID(), epoch: 1, final: fresh('final') };
  await runtime.call('end', end); result.ending = structuredClone(state);
  assert.equal(state.lifecycle, 'ending');
  await peer.command('pause', { value: false });
  await waitFor(() => state.lifecycle === 'ended');
  result.ended = structuredClone(state); result.endedAt = Date.now();
  const marker = end.id + '-marker'; assert.equal(state.messages.find(m => m.id === marker).state, 'delivered');
  await waitFor(() => state.messages.find(m => m.id === marker).state === 'replied');
  result.finalIdentity = await peer.command('identity', {});
  assert.deepEqual(result.finalIdentity.binding, binding); assert.equal(result.finalIdentity.pid, ready.pid);
  const entries = readFileSync(ready.sessionFile, 'utf8').trim().split('\n').map(JSON.parse);
  result.inputs = entries.filter(e => e.type === 'custom_message' && e.customType === 'polish-combined-input').map(e => ({ id: e.id, details: e.details }));
  assert.equal(result.inputs.length, 4);
  for (const [id, count] of admissions) { assert.equal(count, 1); assert.equal(result.inputs.filter(e => e.details.id === id).length, 1); }
  result.admissions = Object.fromEntries(admissions); result.status = 'PASS_COMPONENT';
} catch (error) { result.status = 'FAILED'; result.error = error.stack; process.exitCode = 1; }
finally {
  clearTimeout(deadline); await runtime?.close();
  if (peer.child.exitCode === null && peer.child.signalCode === null) peer.child.kill('SIGTERM');
  result.exit = await peer.exited;
  writeFileSync(join(root, 'evidence', evidencePrefix + '-result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ status: result.status, error: result.error, piPid: result.ready?.pid, inputs: result.inputs?.length }));
