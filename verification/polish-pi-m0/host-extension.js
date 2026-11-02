// Loaded explicitly in the owned Pi test process; no listener or global setup.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Inbox, verifyHistory } from './inbox.js';

export default function (pi) {
  let box, binding, ctx, timer, active;
  const tell = data => ctx.ui.notify(`POLISH_PI_M0 ${JSON.stringify(data)}`, 'info');
  function pump() {
    if (!box || active || !ctx.isIdle() || ctx.hasPendingMessages()) return;
    const id = box.pending()[0];
    if (!id) return;
    box.dispatch(id); active = id;
    const r = box.get(id);
    tell({ kind: 'dispatching', id, binding });
    pi.sendMessage({ customType: 'polish-pi-m0', content: r.text, display: true, details: { ...binding, id, digest: r.digest } }, { triggerTurn: true, deliverAs: 'followUp' });
  }
  pi.on('session_start', (_event, context) => {
    ctx = context;
    const run = resolve(process.env.POLISH_PI_RUN_DIR || '.');
    const allowed = join(dirname(fileURLToPath(import.meta.url)), 'runtime');
    if (dirname(run) !== allowed) throw new Error('ISOLATED_RUN_REQUIRED');
    binding = { instance: randomUUID(), session: ctx.sessionManager.getSessionId() };
    box = new Inbox(join(run, 'host'), binding);
    tell({ kind: 'ready', binding, pid: process.pid, sessionFile: ctx.sessionManager.getSessionFile() });
    timer = setInterval(() => { try { pump(); } catch (error) { clearInterval(timer); tell({ kind: 'fatal', error: error.message }); } }, 100);
  });
  pi.on('context_with_system', event => {
    if (!active) return;
    const inputs = event.messages.filter(m => m.role === 'custom' && m.customType === 'polish-pi-m0' && m.details?.id === active);
    if (inputs.length !== 1) return;
    box.consume(inputs[0].details);
    tell({ kind: 'processing_input', id: active, binding, evidence: 'context_with_system' });
  });
  pi.on('turn_end', event => {
    if (!active || box.get(active).state !== 'processing' || event.message.role !== 'assistant') return;
    // turn_end's entry ID identifies the already-appended assistant record.
    const reply = { entryId: event.messageEntryId, text: event.message.content.filter(c => c.type === 'text').map(c => c.text).join(''), stopReason: event.message.stopReason };
    box.reply(active, reply);
    tell({ kind: 'reply_recorded', id: active, binding, reply });
  });
  pi.on('agent_settled', () => {
    if (active && box.get(active).state === 'replied') active = undefined;
    // Unresolved dispatch or missing final reply stops the queue rather than retrying.
  });
  pi.on('session_shutdown', () => { clearInterval(timer); box?.close(); box = undefined; });
  pi.registerCommand('polish-pi-m0', {
    description: 'Isolated M0 admission/query only',
    handler: async args => {
      let command;
      try {
        command = JSON.parse(args);
        if (command.binding?.instance !== binding.instance || command.binding?.session !== binding.session) throw new Error('BINDING mismatch');
        let value;
        if (command.op === 'admit') {
          const admitted = box.admit(command.message);
          value = { fresh: admitted.fresh, id: admitted.record.id, digest: admitted.record.digest, hostQueued: true, state: admitted.record.state, evidence: 'host_extension_fsynced_inbox', binding };
        } else if (command.op === 'query') {
          const record = box.get(command.id);
          value = record ? { ...verifyHistory(binding, record, ctx.sessionManager.getBranch()), version: box.data.version } : { id: command.id, binding, state: 'no_record', safeToResend: false };
        } else throw new Error('UNSUPPORTED');
        tell({ kind: 'result', requestId: command.requestId, ok: true, value });
      } catch (error) {
        tell({ kind: 'result', requestId: command?.requestId, ok: false, error: error.message });
      }
    },
  });
}
