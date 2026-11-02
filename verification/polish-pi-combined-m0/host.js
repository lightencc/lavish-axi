// Isolated single-Pi inbox. Reuses the prior fsync/rename store, not its message protocol.
import { createHash, randomUUID } from 'node:crypto';
import { Inbox } from '../polish-pi-m0/inbox.js';

const keys = ['artifact', 'instance', 'session', 'epoch', 'id', 'digest', 'attempt'];
export const sameIdentity = (a, b) => !!a && !!b && keys.every(k => a[k] === b[k]);
export class HostInbox extends Inbox {
  admit({ details, text }) {
    if (!details || !['artifact', 'instance', 'session'].every(k => details[k] === this.data.binding[k]) ||
      !Number.isSafeInteger(details.epoch) || details.epoch < 1 || typeof details.attempt !== 'string' || !details.attempt ||
      !/^r2-[a-z0-9-]{1,90}$/.test(details.id) || typeof text !== 'string' || !text.trim() || text.length > 20000 ||
      createHash('sha256').update(text).digest('hex') !== details.digest) throw new Error('IDENTITY');
    const old = this.get(details.id);
    if (old) {
      if (!sameIdentity(old, details) || old.text !== text) throw new Error('CONFLICT');
      return { fresh: false, record: old };
    }
    this.change(s => s.messages.push({ ...details, text, state: 'accepted', admissionId: randomUUID(), admittedAt: Date.now() }));
    return { fresh: true, record: this.get(details.id) };
  }
  consume(details, inputEntryId) {
    this.change(s => {
      const r = s.messages.find(m => m.id === details.id);
      if (!sameIdentity(r, details) || !['dispatching', 'processing'].includes(r.state) || !inputEntryId) throw new Error('IDENTITY');
      r.state = 'processing'; r.inputEntryId = inputEntryId;
      r.inputEvidence = 'context_with_system'; r.inputAt ??= Date.now();
    });
  }
  query(details, entries) {
    const r = this.get(details.id);
    const unknown = { status: 'unknown', safeToResend: false };
    if (!r) return unknown;
    if (!sameIdentity(r, details)) throw new Error('IDENTITY');
    const identity = Object.fromEntries(keys.map(k => [k, r[k]]));
    if (r.state === 'accepted') return { status: 'verified', safeToResend: false, proof: { ...identity, kind: 'queued', evidenceId: r.admissionId } };
    const inputs = entries.filter(e => e.type === 'custom_message' && e.customType === 'polish-combined-input' && sameIdentity(e.details, r));
    if (r.inputEvidence !== 'context_with_system' || inputs.length !== 1 || inputs[0].id !== r.inputEntryId) return unknown;
    const proof = { ...identity, kind: 'consumed', evidenceId: r.inputEntryId, inputEvidence: r.inputEvidence };
    const reply = entries.find(e => e.id === r.reply?.entryId && e.type === 'message' && e.message?.role === 'assistant');
    if (reply && entries.indexOf(reply) > entries.indexOf(inputs[0]) && reply.message.stopReason === 'stop' &&
      reply.message.content.filter(c => c.type === 'text').map(c => c.text).join('') === r.reply.text) {
      proof.kind = 'reply'; proof.evidenceId = reply.id;
      return { status: 'verified', safeToResend: false, proof, reply: r.reply };
    }
    return { status: 'verified', safeToResend: false, proof };
  }
}
