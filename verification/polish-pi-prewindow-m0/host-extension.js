import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { HostInbox, sameIdentity } from './host.js';

export default function (pi) {
  let ctx, box, binding, active, paused = true, stopped = false;
  const tell = data => ctx.ui.notify('POLISH_COMBINED_M0 ' + JSON.stringify({ at: Date.now(), ...data }), 'info');
  const history = () => ctx.sessionManager.getBranch();
  function pump() {
    if (stopped || paused || active || !ctx.isIdle() || ctx.hasPendingMessages()) return;
    const id = box.pending()[0]; if (!id) return;
    box.dispatch(id); active = id;
    const r = box.get(id);
    const details = Object.fromEntries(['artifact', 'instance', 'session', 'epoch', 'id', 'digest', 'attempt'].map(k => [k, r[k]]));
    tell({ kind: 'dispatch', details });
    pi.sendMessage({ customType: 'polish-combined-input', content: r.text, display: true, details }, { triggerTurn: true, deliverAs: 'followUp' });
  }
  const schedule = () => setImmediate(() => { try { pump(); } catch (error) { stopped = true; tell({ kind: 'fatal', error: error.message }); } });
  pi.on('session_start', (_event, context) => {
    ctx = context;
    const run = resolve(process.env.POLISH_COMBINED_RUN_DIR || '.');
    if (dirname(run) !== join(dirname(fileURLToPath(import.meta.url)), 'runtime')) throw new Error('ISOLATED_RUN_REQUIRED');
    binding = { artifact: join(run, 'fixture.html'), instance: randomUUID(), session: ctx.sessionManager.getSessionId() };
    box = new HostInbox(join(run, 'host'), binding);
    tell({ kind: 'ready', binding, pid: process.pid, sessionFile: ctx.sessionManager.getSessionFile() });
  });
  pi.on('context_with_system', event => {
    if (!active) return;
    const record = box.get(active);
    const inputs = event.messages.filter(m => m.role === 'custom' && m.customType === 'polish-combined-input' && sameIdentity(m.details, record));
    const entries = history().filter(e => e.type === 'custom_message' && sameIdentity(e.details, record));
    if (inputs.length !== 1 || entries.length !== 1) throw new Error('INPUT_IDENTITY');
    box.consume(inputs[0].details, entries[0].id);
    tell({ kind: 'proof', result: box.query(inputs[0].details, history()) });
  });
  pi.on('turn_end', event => {
    if (!active || event.message.role !== 'assistant') return;
    const r = box.get(active);
    if (r.state !== 'processing') return;
    box.reply(active, { entryId: event.messageEntryId, text: event.message.content.filter(c => c.type === 'text').map(c => c.text).join(''), stopReason: event.message.stopReason });
    tell({ kind: 'proof', result: box.query(r, history()) });
  });
  pi.on('agent_settled', () => { if (active && box.get(active).state === 'replied') active = undefined; tell({ kind: 'settled' }); schedule(); });
  pi.on('session_shutdown', () => { stopped = true; box?.close(); });
  pi.registerCommand('polish-combined-m0', {
    description: 'Owned isolated M0 transport',
    handler: async args => {
      let c;
      try {
        c = JSON.parse(args);
        if (!['artifact', 'instance', 'session'].every(k => c.binding?.[k] === binding[k])) throw new Error('BINDING');
        let value;
        if (c.op === 'identity') value = { binding, pid: process.pid, session: ctx.sessionManager.getSessionId() };
        else if (c.op === 'pause') { paused = c.value; value = { paused }; }
        else if (c.op === 'admit') { const admitted = box.admit(c.message); value = { ...box.query(c.message.details, history()), fresh: admitted.fresh }; }
        else if (c.op === 'query') value = box.query(c.details, history());
        else throw new Error('UNSUPPORTED');
        tell({ kind: 'result', requestId: c.requestId, ok: true, value }); schedule();
      } catch (error) { tell({ kind: 'result', requestId: c?.requestId, ok: false, error: error.message }); }
    },
  });
}
