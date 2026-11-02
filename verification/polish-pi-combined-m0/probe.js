// Deliberate opt-in real Pi component run; no HTTP server is imported or started.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Authority } from '../polish-pi-recovery-m0/authority.js';
import { startPeer } from './peer.js';
import { startCoordinator } from './coordinator-peer.js';

const root = resolve('verification/polish-pi-combined-m0');
const run = join(root, 'runtime', randomUUID());
mkdirSync(join(run, 'workspace'), { recursive: true, mode: 0o700 });
writeFileSync(join(run, 'fixture.html'), '<!doctype html><title>Pi M0 isolated fixture</title><p>Whole-page submissions have no element anchor.</p>');
const logFile = join(root, 'evidence', 'combined-events.jsonl');
// Never overwrite an earlier run's evidence.
writeFileSync(logFile, '', { flag: 'wx' });
const log = (kind, data) => appendFileSync(logFile, JSON.stringify({ at: Date.now(), kind, ...data }) + '\n');
let owner, binding, relay = true, lostId, snapshot, fatal;
const owners = [], submits = new Map(), hostProofs = [];
const peer = startPeer(run, (kind, data) => {
  log(kind, data);
  if (kind === 'host' && data.kind === 'fatal') fatal = data.error;
  if (kind === 'host' && data.kind === 'proof') {
    hostProofs.push({ at: Date.now(), ...data.result });
    if (relay && owner && data.result.proof) owner.call('reconcile', data.result.proof).catch(error => { fatal = error.message; });
  }
});
async function waitFor(predicate, label, ms = 45000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (fatal) throw new Error(fatal);
    if (Date.now() >= deadline) throw new Error('WAIT_TIMEOUT:' + label);
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
}
const identity = (m, t) => ({ ...binding, epoch: m.epoch, id: m.id, digest: m.digest, attempt: t.attempt });
async function host(message, token) {
  submits.set(message.id, (submits.get(message.id) || 0) + 1);
  const details = identity(message, token);
  log('host-admit-call', { details });
  const result = await peer.command('admit', { message: { text: message.text, details } });
  if (message.id === lostId) { log('injected-lost-admission-receipt', { details, hostResult: result }); throw new Error('INJECTED_LOST_RECEIPT'); }
  if (!result.proof) throw new Error('HOST_RESULT_UNKNOWN');
  return result.proof;
}
async function newOwner() {
  const p = startCoordinator(join(run, 'authority'), binding, host, log); owners.push(p); owner = p;
  p.subscribe(event => { snapshot = event.snapshot; });
  const r = await p.ready; snapshot = r.snapshot; return r;
}
async function restart(ready) {
  const previous = owner; previous.child.kill('SIGKILL'); await previous.exited;
  const recovered = Authority.recoverOwned(join(run, 'authority'), binding, previous.child, ready.nonce);
  log('supervisor-recovered', { priorPid: previous.child.pid, snapshot: recovered.snapshot() }); recovered.close();
  const current = await newOwner();
  const live = await peer.command('identity', {});
  assert.equal(live.pid, peer.child.pid); assert.deepEqual(live.binding, binding); assert.equal(live.session, binding.session);
  log('same-live-pi', live); return current;
}
const message = label => ({ id: 'r2-' + randomUUID(), epoch: 1, text: `[POLISH-COMBINED-M0 ${label}] Isolated transport test. Reply exactly R2_ACK. No tools, file changes or other sessions.` });
const result = { version: 'r2', runtime: run, actualPoll: 'NOT RUN', browser: 'NOT RUN', historicalReplays: 0 };
const deadline = setTimeout(() => { fatal = 'RUN_TIMEOUT'; peer.child.kill('SIGTERM'); }, 150000);
try {
  const ready = await peer.ready; binding = ready.binding;
  assert.equal(ready.pid, peer.child.pid);
  result.ready = ready;
  let coordinatorReady = await newOwner();
  const first = message('accepted-before-owner-crash');
  await owner.call('admit', first);
  const acceptedBefore = await owner.call('snapshot');
  assert.equal(acceptedBefore.messages[0].state, 'accepted'); assert.equal(submits.size, 0);
  coordinatorReady = await restart(coordinatorReady);
  await assert.rejects(owner.call('claim', { mode: 'poll', id: first.id }), /MODE/);
  await peer.command('pause', { value: false });
  await owner.call('start');
  await waitFor(() => snapshot.messages.find(m => m.id === first.id)?.state === 'replied', 'first-reply');
  result.acceptedRecovery = { before: acceptedBefore, after: snapshot, admits: submits.get(first.id), samePid: peer.child.pid };
  assert.equal(submits.get(first.id), 1);

  await peer.command('pause', { value: true });
  const lost = message('lost-admission-receipt'); lostId = lost.id; relay = false;
  await owner.call('admit', lost);
  const uncertain = await owner.call('snapshot');
  const lostRecord = uncertain.messages.find(m => m.id === lost.id);
  assert.equal(lostRecord.state, 'unknown'); assert.equal(lostRecord.consumed, false);
  coordinatorReady = await restart(coordinatorReady);
  await assert.rejects(owner.call('record', { token: lostRecord.claim, proof: {} }), /STALE/);
  const queried = await peer.command('query', { details: identity(lostRecord, lostRecord.claim) });
  assert.equal(queried.proof.kind, 'queued');
  await owner.call('reconcile', queried.proof);
  await assert.rejects(owner.call('mode', { mode: 'poll' }), /UNSETTLED/);
  const absent = await peer.command('query', { details: { ...identity(lostRecord, lostRecord.claim), id: 'r2-' + randomUUID() } });
  assert.deepEqual(absent, { status: 'unknown', safeToResend: false });
  relay = true; lostId = undefined;
  await owner.call('start'); await peer.command('pause', { value: false });
  await waitFor(() => snapshot.messages.find(m => m.id === lost.id)?.state === 'replied', 'recovered-queue-reply');
  assert.equal(submits.get(lost.id), 1);
  result.lostAdmission = { uncertain, queried, absent, after: snapshot, admits: submits.get(lost.id) };

  await peer.command('pause', { value: true });
  const prior = message('final-batch-existing'), final = message('final-batch-final'), endId = 'r2-' + randomUUID();
  await owner.call('admit', prior);
  await owner.call('end', { id: endId, epoch: 1, final });
  const beforeDrain = await owner.call('snapshot');
  assert.equal(beforeDrain.lifecycle, 'ending');
  assert.equal(beforeDrain.messages.find(m => m.id === endId + '-marker').consumed, false);
  await assert.rejects(owner.call('admit', message('late-new-input')), /CLOSED/);
  await peer.command('pause', { value: false });
  await waitFor(() => snapshot.lifecycle === 'ended', 'marker-consumed');
  const endedAt = Date.now(), ended = structuredClone(snapshot);
  assert.ok(ended.end.ids.every(id => ended.messages.find(m => m.id === id).consumed));
  assert.equal(ended.messages.find(m => m.id === endId + '-marker').state, 'delivered');
  assert.ok(!hostProofs.some(p => p.proof?.id === endId + '-marker' && p.proof.kind === 'reply'));
  result.end = { beforeDrain, endedAt, ended, markerReplyPresentAtEnded: false };
  await waitFor(() => snapshot.messages.find(m => m.id === endId + '-marker')?.state === 'replied', 'marker-reply');
  result.end.afterReply = snapshot;
  result.finalIdentity = await peer.command('identity', {});
  assert.deepEqual(result.finalIdentity.binding, binding); assert.equal(result.finalIdentity.pid, ready.pid);
  const entries = readFileSync(ready.sessionFile, 'utf8').trim().split('\n').map(JSON.parse);
  const inputs = entries.filter(e => e.type === 'custom_message' && e.customType === 'polish-combined-input');
  assert.equal(inputs.length, 5);
  for (const [id, count] of submits) { assert.equal(count, 1); assert.equal(inputs.filter(e => e.details.id === id).length, 1); }
  result.inputs = inputs.map(e => ({ id: e.id, parentId: e.parentId, details: e.details }));
  result.hostProofs = hostProofs;
  result.admitCounts = Object.fromEntries(submits);
  result.status = 'PASS_COMPONENT_SUBCASES';
  await owner.call('close'); await owner.exited;
} catch (error) {
  result.status = 'FAILED'; result.error = error.stack; process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  for (const p of owners) {
    if (p.child.exitCode === null && p.child.signalCode === null) p.child.kill('SIGTERM');
    await p.exited;
  }
  if (peer.child.exitCode === null && peer.child.signalCode === null) peer.child.kill('SIGTERM');
  result.piExit = await peer.exited;
  result.ownerExits = owners.map(p => ({ pid: p.child.pid, code: p.child.exitCode, signal: p.child.signalCode }));
  writeFileSync(join(root, 'evidence', 'combined-result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ status: result.status, error: result.error, pid: result.ready?.pid, inputs: result.inputs?.length, admits: result.admitCounts }));
