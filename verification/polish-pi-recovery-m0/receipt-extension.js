import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSync, closeSync, fsyncSync, readFileSync } from 'node:fs';

export default function (pi) {
  let ctx, binding, active, witnessed = false;
  const tell = data => ctx.ui.notify('POLISH_RECOVERY_M0 ' + JSON.stringify(data), 'info');
  pi.on('session_start', (_event, context) => {
    ctx = context;
    const root = join(dirname(fileURLToPath(import.meta.url)), 'runtime');
    if (dirname(resolve(process.env.POLISH_RECOVERY_RUN_DIR || '.')) !== root || !['gap', 'receipt'].includes(process.env.POLISH_RECOVERY_WINDOW)) throw new Error('ISOLATED_RUN_REQUIRED');
    binding = { artifact: 'recovery-m0-artifact', instance: randomUUID(), session: ctx.sessionManager.getSessionId() };
    tell({ kind: 'ready', binding, pid: process.pid, sessionFile: ctx.sessionManager.getSessionFile() });
  });
  pi.registerCommand('polish-recovery-m0', {
    description: 'One isolated receipt-window probe',
    handler: async args => {
      const message = JSON.parse(args);
      if (active || !/^r1-[a-z0-9-]+$/.test(message.details.id) || !message.text.startsWith('[POLISH-RECOVERY-M0 ')) throw new Error('ONLY_ONE_NEW_PROBE');
      if (!Object.entries(binding).every(([k, v]) => message.details[k] === v)) throw new Error('BINDING');
      active = message.details;
      pi.sendMessage({ customType: 'polish-recovery-input', content: message.text, display: true, details: active }, { triggerTurn: true, deliverAs: 'followUp' });
    },
  });
  pi.on('context_with_system', event => {
    if (!active || witnessed) return;
    if (!event.messages.some(m => m.role === 'custom' && m.customType === 'polish-recovery-input' && m.details?.attempt === active.attempt)) return;
    witnessed = true; tell({ kind: 'input', details: active });
  });
  pi.on('turn_end', async event => {
    if (!active || !witnessed || event.message.role !== 'assistant' || event.message.stopReason !== 'stop') return;
    if (process.env.POLISH_RECOVERY_WINDOW === 'gap') {
      // Deliberately omit reply ID: the sidecar must not obtain an alternate association here.
      tell({ kind: 'checkpoint', window: 'reply_before_receipt', id: active.id });
      await new Promise(() => {}); return;
    }
    const inputs = ctx.sessionManager.getBranch().filter(e => e.type === 'custom_message' && e.customType === 'polish-recovery-input' && e.details?.attempt === active.attempt);
    if (inputs.length !== 1) throw new Error('INPUT_AMBIGUOUS');
    pi.appendEntry('polish-recovery-receipt', { ...active, inputEntryId: inputs[0].id, replyEntryId: event.messageEntryId, inputEvidence: 'context_with_system' });
    const file = ctx.sessionManager.getSessionFile();
    const fd = openSync(file, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
    const entries = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
    const marker = entries.find(e => e.type === 'custom' && e.customType === 'polish-recovery-receipt' && e.data?.attempt === active.attempt);
    if (!marker) throw new Error('RECEIPT_NOT_ON_DISK');
    tell({ kind: 'checkpoint', window: 'receipt_before_sidecar', id: active.id, receiptEntryId: marker.id });
    await new Promise(() => {});
  });
}
