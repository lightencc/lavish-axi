// Two bounded, owned Pi component experiments; no network listener or historical replay.
import { spawn } from 'node:child_process';
import { mkdirSync, appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Authority } from './authority.js';
import { recoverReply } from './receipt.js';

const root = resolve('verification/polish-pi-recovery-m0');
const file = join(root, 'evidence/pi-window-events.jsonl');
if (existsSync(file)) throw new Error('Existing evidence; refuse automatic replay');
const log = (kind, data) => appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), kind, data }) + '\n', { mode: 0o600 });
async function run(window) {
  const dir = join(root, 'runtime', randomUUID()); mkdirSync(join(dir, 'workspace'), { recursive: true, mode: 0o700 });
  const args = ['--mode', 'rpc', '--offline', '--no-tools', '--no-mcp', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-approve', '--extension', join(root, 'receipt-extension.js'), '--session-dir', join(dir, 'sessions'), '--name', 'POLISH-RECOVERY-M0-' + window + '-' + randomUUID()];
  const child = spawn('pi', args, { cwd: join(dir, 'workspace'), env: { ...process.env, POLISH_RECOVERY_RUN_DIR: dir, POLISH_RECOVERY_WINDOW: window }, stdio: ['pipe', 'pipe', 'pipe'] });
  let ready, authority, token, checkpoint, rest = '', fault;
  log('start', { window, pid: child.pid, args });
  const deadline = setTimeout(() => { fault = 'TIMEOUT'; log('timeout', { window, pid: child.pid }); child.kill('SIGTERM'); }, 45000);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    const lines = (rest + chunk).split('\n'); rest = lines.pop();
    for (const line of lines.filter(Boolean)) {
      try {
        const event = JSON.parse(line);
        if (event.type !== 'extension_ui_request' || event.method !== 'notify' || !event.message?.startsWith('POLISH_RECOVERY_M0 ')) continue;
        const data = JSON.parse(event.message.slice('POLISH_RECOVERY_M0 '.length)); log('host', { window, ...data });
        if (data.kind === 'ready') {
          assert.equal(data.pid, child.pid); ready = data;
          authority = new Authority(join(dir, 'authority'), ready.binding);
          const id = 'r1-' + randomUUID();
          const text = `[POLISH-RECOVERY-M0 ${id}] Isolated receipt-window test. Reply exactly RECOVERY_ACK. No tools, file edits, or other sessions.`;
          const record = authority.admit({ id, text, epoch: 1 }); token = authority.claim('bridge', id);
          const details = { ...ready.binding, id, epoch: 1, digest: record.digest, attempt: token.attempt };
          log('bound_and_dispatched', { window, pid: child.pid, binding: ready.binding, token, digest: record.digest });
          child.stdin.write(JSON.stringify({ id: randomUUID(), type: 'prompt', message: '/polish-recovery-m0 ' + JSON.stringify({ details, text }) }) + '\n');
        }
        if (data.kind === 'input') authority.record(token, { ...data.details, kind: 'consumed', evidenceId: 'context-' + token.attempt, inputEvidence: 'context_with_system' });
        if (data.kind === 'checkpoint') {
          checkpoint = data; log('before_kill', { window, pid: child.pid, snapshot: authority.snapshot() });
          // This is the ChildProcess just spawned by this supervisor, not a port or guessed PID.
          child.kill('SIGKILL');
        }
      } catch (error) { fault = error.message; log('handler_failure', { window, error: error.message }); child.kill('SIGTERM'); }
    }
  });
  child.stderr.on('data', chunk => log('stderr_bytes', { window, bytes: chunk.length }));
  try {
    const exit = await new Promise((resolveExit, reject) => { child.on('exit', (code, signal) => resolveExit({ code, signal })); child.on('error', reject); });
    clearTimeout(deadline); log('exit', { window, pid: child.pid, ...exit });
    if (fault || !checkpoint) throw new Error(fault || 'NO_CHECKPOINT');
    assert.equal(exit.signal, 'SIGKILL');
    authority.uncertain(token);
    const entries = readFileSync(ready.sessionFile, 'utf8').trim().split('\n').map(JSON.parse);
    const before = authority.snapshot();
    const record = before.messages.find(m => m.id === token.id);
    const result = recoverReply(ready.binding, record, entries);
    const retained = entries.filter(e => (e.type === 'custom_message' && e.customType === 'polish-recovery-input') || (e.type === 'custom' && e.customType === 'polish-recovery-receipt') || (e.type === 'message' && e.message.role === 'assistant')).map(e => e.type === 'message' ? { id: e.id, type: e.type, parentId: e.parentId, role: e.message.role, text: e.message.content.filter(c => c.type === 'text').map(c => c.text).join(''), stopReason: e.message.stopReason } : { ...e, content: undefined });
    if (result.status === 'verified_reply') authority.reconcile(result.proof);
    const after = authority.snapshot();
    if (window === 'gap') { assert.equal(result.status, 'unknown'); assert.equal(after.messages[0].executionUnknown, true); assert.ok(retained.some(e => e.role === 'assistant')); }
    else { assert.equal(result.status, 'verified_reply'); assert.equal(after.messages[0].state, 'replied'); assert.equal(after.messages[0].executionUnknown, false); }
    const summary = { window, pid: child.pid, binding: ready.binding, checkpoint, before, result, after, hostEntries: retained, newProcessForRecovery: false, resends: 0, runtime: dir, sessionFile: ready.sessionFile };
    writeFileSync(join(root, 'evidence', `pi-${window}-result.json`), JSON.stringify(summary, null, 2) + '\n');
    log('readonly_recovery', { window, result, sidecarState: after.messages[0].state, executionUnknown: after.messages[0].executionUnknown, resends: 0 });
  } finally { clearTimeout(deadline); authority?.close(); if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); }
}
await run('receipt');
await run('gap');
console.log('Receipt-present window recovered; receipt-absent window remains unknown. No listener or replay.');
