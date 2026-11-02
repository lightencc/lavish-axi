// Test supervisor only. All control uses stdin/stdout, never an additional HTTP route.
import { Server } from 'node:net';
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, appendFileSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startPreview } from './launcher.js';

const root = resolve('verification/polish-pi-web2-m0/evidence');
const log = (kind, data) => appendFileSync(join(root, 'supervisor.jsonl'), JSON.stringify({ at: Date.now(), kind, data }) + '\n');
const emit = data => process.stdout.write(JSON.stringify(data) + '\n');
let app, startedAt, deadline, watchdog, stopped = false, stopping, binds = 0;
const originalListen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  if (++binds !== 1 || args[0] !== 49793 || args[1] !== '127.0.0.1') throw new Error('OUTSIDE_APPROVED_WINDOW');
  this.once('listening', () => {
    startedAt = Date.now(); deadline = startedAt + 600000;
    const identity = { startedAt, deadline, startedUTC: new Date(startedAt).toISOString(), deadlineUTC: new Date(deadline).toISOString(), address: this.address(), supervisorPid: process.pid };
    writeFileSync(join(root, 'window.json'), JSON.stringify(identity, null, 2) + '\n', { flag: 'wx' });
    log('actual-listening', identity); emit({ kind: 'listening', ...identity });
    watchdog = setTimeout(() => { void stop('hard-deadline'); }, Math.max(0, deadline - Date.now()));
  });
  this.once('close', () => log('actual-listener-close', { elapsedMs: Date.now() - startedAt }));
  return originalListen.apply(this, args);
};
let direct, rest = '';
async function stop(reason) {
  if (stopping) return stopping;
  stopped = true;
  stopping = (async () => {
    clearTimeout(watchdog);
    log('stop-request', { reason });
    await app?.stop();
    if (app) {
      copyFileSync(join(app.run, 'state.json'), join(root, 'final-state.json'));
      copyFileSync(join(app.run, 'web-events.jsonl'), join(root, 'web-events.jsonl'));
      copyFileSync(join(app.run, 'host', 'inbox.json'), join(root, 'host-inbox.json'));
      const ready = readFileSync(join(app.run, 'web-events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).find(e => e.kind === 'host' && e.data.kind === 'ready').data;
      const entries = readFileSync(ready.sessionFile, 'utf8').trim().split('\n').map(JSON.parse);
      const retained = entries.filter(e => e.type === 'custom_message' || e.type === 'message').map(e => e.type === 'custom_message' ? { id: e.id, parentId: e.parentId, type: e.type, customType: e.customType, details: e.details } : { id: e.id, parentId: e.parentId, type: e.type, role: e.message.role, text: (e.message.content || []).filter(c => c.type === 'text').map(c => c.text).join(''), model: e.message.model, provider: e.message.provider, usage: e.message.usage, stopReason: e.message.stopReason });
      writeFileSync(join(root, 'host-entries.json'), JSON.stringify(retained, null, 2) + '\n');
      log('stopped', { reason, elapsedMs: Date.now() - startedAt, peerPid: app.peer.child.pid, exitCode: app.peer.child.exitCode, signalCode: app.peer.child.signalCode });
    }
    emit({ kind: 'stopped', reason });
    rl.close(); process.stdin.pause();
  })();
  return stopping;
}
const rl = createInterface({ input: process.stdin });
try {
  app = await startPreview();
  const identity = { binding: app.binding, run: app.run, piPid: app.peer.child.pid, supervisorPid: process.pid, startedAt, deadline };
  writeFileSync(join(root, 'identity.json'), JSON.stringify(identity, null, 2) + '\n', { flag: 'wx' });
  emit({ kind: 'ready', ...identity }); log('ready', identity);
  const originalCommand = app.peer.command.bind(app.peer);
  let dropNextAdmission = false;
  app.peer.command = async (op, data) => {
    const value = await originalCommand(op, data);
    if (op === 'admit' && dropNextAdmission) { dropNextAdmission = false; log('injected-admission-receipt-loss', { message: data.message.details, result: value }); throw new Error('INJECTED_ADMISSION_RECEIPT_LOSS'); }
    return value;
  };
  app.peer.child.stdout.on('data', chunk => {
    const lines = (rest + chunk).split('\n'); rest = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const e = JSON.parse(line);
      if (!direct) continue;
      if (e.type === 'message_update' && e.assistantMessageEvent?.type === 'text_delta') direct.firstTextAt ??= Date.now();
      if (e.type === 'message_end' && e.message?.role === 'assistant') { direct.replyAt = Date.now(); direct.usage = e.message.usage; direct.model = e.message.model; direct.provider = e.message.provider; direct.stopReason = e.message.stopReason; direct.text = e.message.content.filter(c => c.type === 'text').map(c => c.text).join(''); }
      if (e.type === 'agent_settled') { const finished = direct; direct = null; clearTimeout(finished.timer); delete finished.timer; const done = finished.done; delete finished.done; log('direct-sample', finished); done(finished); }
    }
  });
  rl.on('line', async line => {
    let c;
    try {
      c = JSON.parse(line); if (stopped && c.op !== 'stop') throw new Error('WINDOW_CLOSED');
      let value;
      if (c.op === 'status') { const s = await app.runtime.snapshot(); value = { now: Date.now(), remainingMs: deadline - Date.now(), lifecycle: s.lifecycle, mode: s.mode, version: s.version, messages: s.messages.map(m => ({ id: m.id, state: m.state, consumed: m.consumed })) }; }
      else if (c.op === 'pause') value = await app.peer.command('pause', { value: c.value });
      else if (c.op === 'mode') value = await app.runtime.call('mode', { mode: c.mode });
      else if (c.op === 'drop-next-admission') { dropNextAdmission = true; value = { armed: true }; }
      else if (c.op === 'recover-id') { const m = (await app.runtime.snapshot()).messages.find(m => m.id === c.id); const result = await app.peer.command('query', { details: m.claim }); if (result.proof) await app.runtime.call('reconcile', result.proof); value = result; }
      else if (c.op === 'poll') {
        const url = new URL(app.origin + '/api/poll'); url.searchParams.set('file', app.binding.artifact); url.searchParams.set('timeoutMs', String(c.timeoutMs || 1000));
        if (c.method === 'POST') url.searchParams.set('takeover', '1');
        const res = await fetch(url, c.method === 'POST' ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } : undefined);
        const body = await res.json(); const before = await app.runtime.snapshot();
        if (c.deliver && body.delivery) await app.runtime.deliver(body);
        value = { httpStatus: res.status, body, afterHttp: before, deliveredToAdapter: !!(c.deliver && body.delivery) };
      } else if (c.op === 'direct') {
        const records = [];
        for (let i = 0; i < c.count && !stopped && deadline - Date.now() > 25000; i++) {
          const id = 'direct-w2-' + randomUUID();
          const outcome = new Promise((done, reject) => { direct = { id, submittedAt: Date.now(), done, timer: setTimeout(() => { direct = null; reject(new Error('DIRECT_REPLY_UNKNOWN')); }, 20000) }; });
          await app.peer.rpc({ type: 'prompt', message: `[${id}] Isolated performance test. Reply exactly W2_ACK. No tools or file changes.` });
          records.push(await outcome);
        }
        value = records;
      } else if (c.op === 'host-state') value = await app.peer.rpc({ type: 'get_state' });
      else if (c.op === 'stop') { await stop('operator-finished'); return; }
      else throw new Error('UNSUPPORTED');
      log('control-result', { op: c.op, value });
      writeFileSync(join(root, (c.name || c.op) + '.json'), JSON.stringify(value, null, 2) + '\n');
      emit({ kind: 'control-result', op: c.op, file: c.name || c.op, summary: Array.isArray(value) ? { count: value.length } : c.op === 'status' ? value : { ok: true } });
    } catch (error) { log('control-error', { command: c, error: error.stack }); emit({ kind: 'error', op: c?.op, error: error.message }); }
  });
} catch (error) { log('startup-error', { error: error.stack }); emit({ kind: 'startup-error', error: error.message }); await stop('startup-failed'); process.exitCode = 1; }
