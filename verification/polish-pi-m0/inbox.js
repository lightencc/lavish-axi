// Isolated M0 storage. A positive witness is not an exactly-once guarantee.
import { openSync, closeSync, writeFileSync, fsyncSync, readFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const digest = text => createHash('sha256').update(text).digest('hex');
const sameBinding = (a, b) => a.instance === b.instance && a.session === b.session;
export class Inbox {
  constructor(dir, binding) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.dir = dir; this.path = join(dir, 'inbox.json'); this.lockPath = join(dir, 'writer.lock');
    this.lock = openSync(this.lockPath, 'wx', 0o600);
    try {
      this.data = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : { binding, version: 0, messages: [] };
      if (!sameBinding(this.data.binding, binding)) throw new Error('BINDING mismatch');
      writeFileSync(this.lock, JSON.stringify({ pid: process.pid, ...binding })); fsyncSync(this.lock);
      if (!existsSync(this.path)) this.commit(this.data);
    } catch (error) { this.close(); throw error; }
  }
  commit(data) {
    const temp = join(this.dir, `${randomUUID()}.tmp`);
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(data)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, this.path);
    const dirfd = openSync(this.dir, 'r');
    try { fsyncSync(dirfd); } finally { closeSync(dirfd); }
    this.data = data;
  }
  change(fn) {
    if (this.lock === undefined) throw new Error('CLOSED');
    const next = structuredClone(this.data); fn(next); next.version++;
    this.commit(next);
  }
  admit({ id, text, ...extra }) {
    if (Object.keys(extra).length || !/^pi3-[a-z0-9-]{8,80}$/.test(id) || typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 12000) throw new Error('INVALID_MESSAGE');
    const existing = this.get(id), hash = digest(text);
    if (existing) {
      if (existing.digest !== hash) throw new Error('CONFLICT');
      return { fresh: false, record: existing };
    }
    this.change(data => data.messages.push({ ...data.binding, id, text, digest: hash, state: 'accepted', admittedAt: new Date().toISOString() }));
    return { fresh: true, record: this.get(id) };
  }
  get(id) { return structuredClone(this.data.messages.find(r => r.id === id)); }
  pending() { return this.data.messages.filter(r => r.state === 'accepted').map(r => r.id); }
  dispatch(id) {
    this.change(data => {
      const r = data.messages.find(x => x.id === id);
      if (!r || r.state !== 'accepted') throw new Error('NOT_ACCEPTED');
      r.state = 'dispatching'; r.dispatchAt = new Date().toISOString();
    });
  }
  consume(details) {
    this.change(data => {
      const r = data.messages.find(x => x.id === details.id);
      if (!r || !sameBinding(r, details) || r.digest !== details.digest || !['dispatching', 'processing'].includes(r.state)) throw new Error('IDENTITY mismatch');
      r.state = 'processing'; r.inputAt ??= new Date().toISOString(); r.inputEvidence = 'context_with_system';
    });
  }
  reply(id, reply) {
    this.change(data => {
      const r = data.messages.find(x => x.id === id);
      if (!r || r.state !== 'processing' || typeof reply.entryId !== 'string' || !reply.entryId) throw new Error('REPLY_WITHOUT_INPUT');
      r.state = 'replied'; r.reply = reply; r.replyAt = new Date().toISOString();
    });
  }
  close() {
    if (this.lock === undefined) return;
    closeSync(this.lock); this.lock = undefined; unlinkSync(this.lockPath);
  }
}

export function verifyHistory(binding, record, entries) {
  if (!sameBinding(binding, record)) throw new Error('BINDING mismatch');
  const inputs = entries.filter(e => e.type === 'custom_message' && e.customType === 'polish-pi-m0' && e.details?.id === record.id && e.details.digest === record.digest && sameBinding(e.details, binding));
  const replyEntry = entries.find(e => e.id === record.reply?.entryId && e.type === 'message' && e.message?.role === 'assistant');
  const replyText = replyEntry?.message.content.filter(c => c.type === 'text').map(c => c.text).join('');
  const replyVerified = inputs.length === 1 && !!replyEntry && replyText === record.reply.text && replyEntry.message.stopReason === record.reply.stopReason;
  return {
    id: record.id, binding, digest: record.digest, state: record.state,
    inputStored: inputs.length === 1, inputEntryIds: inputs.map(e => e.id),
    delivery: record.inputEvidence === 'context_with_system' ? 'input_witnessed' : 'unknown',
    replyVerified, reply: replyVerified ? record.reply : null,
    // Even an empty history cannot disprove an in-flight or lost host operation.
    safeToResend: false,
  };
}
