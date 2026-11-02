// Isolated M0 authority. No network and no host-execution guarantee.
import { ChildProcess } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, fsyncSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const hash = x => createHash('sha256').update(x).digest('hex');
const bound = (a, b) => ['artifact', 'instance', 'session'].every(k => a[k] === b[k]);
const unsettled = m => ['dispatching', 'host_queued', 'unknown'].includes(m.state);
const view = s => structuredClone({ binding: s.binding, generation: s.generation, epoch: s.epoch, version: s.version, lifecycle: s.lifecycle, mode: s.mode, messages: s.messages, end: s.end });

export class Authority {
  constructor(dir, binding, recovering = false) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.dir = dir; this.file = join(dir, 'state.json'); this.lockFile = join(dir, 'writer.lock');
    this.listeners = new Set(); this.nonce = randomUUID();
    this.lock = openSync(this.lockFile, 'wx', 0o600);
    try {
      const exists = existsSync(this.file);
      this.data = exists ? JSON.parse(readFileSync(this.file, 'utf8')) : { binding, generation: 0, epoch: 1, version: 0, lifecycle: 'open', mode: 'bridge', messages: [], end: null, events: [], closed: true };
      if (!bound(binding, this.data.binding)) throw new Error('BINDING');
      if (!this.data.closed && !recovering) throw new Error('UNCLEAN_RECOVERY_REQUIRED');
      writeFileSync(this.lock, JSON.stringify({ pid: process.pid, nonce: this.nonce })); fsyncSync(this.lock);
      this.change(s => {
        s.generation++; s.closed = false;
        for (const m of s.messages) if (unsettled(m)) m.state = 'unknown';
      });
    } catch (error) { closeSync(this.lock); this.lock = undefined; unlinkSync(this.lockFile); throw error; }
  }
  static recoverOwned(dir, binding, child, nonce) {
    if (!(child instanceof ChildProcess) || (child.exitCode === null && child.signalCode === null)) throw new Error('EXIT_PROOF_REQUIRED');
    const gatePath = join(dir, 'recovery.lock'); const gate = openSync(gatePath, 'wx', 0o600);
    try {
      const path = join(dir, 'writer.lock'); const owner = JSON.parse(readFileSync(path, 'utf8'));
      if (owner.pid !== child.pid || owner.nonce !== nonce) throw new Error('OWNER_MISMATCH');
      renameSync(path, join(dir, `retired-${nonce}.json`));
      return new Authority(dir, binding, true);
    } finally { closeSync(gate); unlinkSync(gatePath); }
  }
  change(fn) {
    if (this.lock === undefined || this.poisoned) throw new Error('AUTHORITY_UNAVAILABLE');
    const next = structuredClone(this.data); fn(next); next.version++;
    const event = { version: next.version, epoch: next.epoch, snapshot: view(next) };
    next.events.push(event); next.events = next.events.slice(-64);
    const temp = join(this.dir, `${randomUUID()}.tmp`);
    try {
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, JSON.stringify(next)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, this.file);
      const dirfd = openSync(this.dir, 'r'); try { fsyncSync(dirfd); } finally { closeSync(dirfd); }
    } catch (error) { this.poisoned = true; throw error; }
    this.data = next;
    for (const listener of this.listeners) { try { listener(structuredClone(event)); } catch { this.listeners.delete(listener); } }
  }
  snapshot() { if (this.poisoned) throw new Error('AUTHORITY_UNAVAILABLE'); return view(this.data); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  _epoch(epoch) { if (epoch !== this.data.epoch) throw new Error('EPOCH'); }
  _message(s, message, kind = 'message') {
    if (!/^[a-z0-9-]{1,100}$/.test(message.id) || typeof message.text !== 'string' || !message.text || message.text.length > 20000) throw new Error('INVALID');
    const digest = hash(message.text); const old = s.messages.find(m => m.id === message.id);
    if (old) { if (old.digest !== digest || old.kind !== kind) throw new Error('CONFLICT'); return old; }
    const r = { id: message.id, text: message.text, digest, epoch: s.epoch, kind, state: 'accepted', consumed: false };
    s.messages.push(r); return r;
  }
  admit(message) {
    this._epoch(message.epoch);
    const old = this.data.messages.find(m => m.id === message.id);
    if (old) { if (old.digest !== hash(message.text)) throw new Error('CONFLICT'); return structuredClone(old); }
    if (this.data.lifecycle !== 'open') throw new Error('CLOSED');
    this.change(s => this._message(s, message)); return this.snapshot().messages.at(-1);
  }
  switchMode(mode) {
    if (!['bridge', 'poll'].includes(mode)) throw new Error('MODE');
    if (this.data.messages.some(unsettled)) throw new Error('UNSETTLED');
    this.change(s => { s.mode = mode; s.generation++; });
  }
  claim(mode, id) {
    if (mode !== this.data.mode) throw new Error('MODE');
    if (this.data.lifecycle === 'ended') throw new Error('CLOSED');
    const r = this.data.messages.find(m => m.id === id);
    if (!r || r.state !== 'accepted') throw new Error('NOT_ACCEPTED');
    if (this.data.messages.some(unsettled)) throw new Error('UNSETTLED');
    if (r.kind === 'end' && this.data.messages.some(m => m.id !== id && !m.consumed)) throw new Error('DRAIN_ORDER');
    const token = { id, epoch: this.data.epoch, generation: this.data.generation, nonce: this.nonce, attempt: randomUUID() };
    this.change(s => { const m = s.messages.find(x => x.id === id); m.state = 'dispatching'; m.claim = token; });
    return token;
  }
  _token(token) {
    this._epoch(token.epoch);
    if (token.generation !== this.data.generation || token.nonce !== this.nonce) throw new Error('STALE');
    if (this.data.messages.find(m => m.id === token.id)?.claim?.attempt !== token.attempt) throw new Error('STALE');
  }
  uncertain(token) {
    this._token(token);
    this.change(s => { const m = s.messages.find(x => x.id === token.id); if (!m.consumed) m.state = 'unknown'; else m.executionUnknown = true; });
  }
  record(token, proof) { this._token(token); if (proof.id !== token.id || proof.attempt !== token.attempt) throw new Error('IDENTITY'); this.reconcile(proof); }
  // Called only by the trusted host adapter; synthetic unit receipts are not host proof.
  reconcile(proof) {
    this._epoch(proof.epoch);
    const r = this.data.messages.find(m => m.id === proof.id);
    if (!r?.claim || typeof proof.attempt !== 'string' || !bound(this.data.binding, proof) || r.digest !== proof.digest || r.claim.attempt !== proof.attempt || typeof proof.evidenceId !== 'string' || !proof.evidenceId) throw new Error('IDENTITY');
    if (!['queued', 'consumed', 'reply'].includes(proof.kind)) throw new Error('EVIDENCE');
    if (proof.kind !== 'queued' && proof.inputEvidence !== 'context_with_system') throw new Error('EVIDENCE');
    this.change(s => {
      const m = s.messages.find(x => x.id === proof.id);
      if (proof.kind === 'queued' && !m.consumed) { m.state = 'host_queued'; m.queueEvidence = proof.evidenceId; }
      if (proof.kind !== 'queued') {
        m.consumed = true; m.inputEvidence = proof.inputEvidence;
        if (m.state !== 'replied') m.state = 'delivered';
      }
      if (proof.kind === 'reply') { m.state = 'replied'; m.replyEvidence = proof.evidenceId; m.executionUnknown = false; }
      if (s.lifecycle === 'ending' && s.end.ids.every(id => s.messages.find(x => x.id === id).consumed)) s.lifecycle = 'ended';
    });
  }
  beginEnd(request) {
    this._epoch(request.epoch);
    const digest = hash(JSON.stringify({ id: request.id, epoch: request.epoch, final: request.final ? { id: request.final.id, text: request.final.text, epoch: request.final.epoch } : null }));
    if (this.data.end) { if (this.data.end.id !== request.id || this.data.end.digest !== digest) throw new Error('CONFLICT'); return; }
    if (this.data.lifecycle !== 'open') throw new Error('CLOSED');
    this.change(s => {
      if (request.final) { if (request.final.epoch !== s.epoch) throw new Error('EPOCH'); this._message(s, request.final); }
      this._message(s, { id: request.id + '-marker', text: 'Review ended: ' + request.id }, 'end');
      s.end = { id: request.id, digest, ids: s.messages.map(m => m.id) }; s.lifecycle = 'ending';
    });
  }
  reopen() {
    if (this.data.lifecycle !== 'ended') throw new Error('NOT_ENDED');
    this.change(s => { s.epoch++; s.lifecycle = 'open'; s.messages = []; s.end = null; });
  }
  close() {
    if (this.lock === undefined) return;
    if (!this.poisoned) this.change(s => { s.closed = true; });
    closeSync(this.lock); this.lock = undefined;
    if (!this.poisoned) unlinkSync(this.lockFile);
  }
}

export class Replica {
  constructor() { this.state = null; this.buffer = new Map(); this.needsSnapshot = true; }
  begin(connection) { this.connection = connection; this.buffer.clear(); this.ready = false; this.needsSnapshot = true; }
  snapshot(connection, state) {
    if (connection !== this.connection || (this.state && state.version < this.state.version)) return false;
    this.state = structuredClone(state); this.ready = true;
    for (const version of this.buffer.keys()) if (version <= state.version) this.buffer.delete(version);
    this.drain(); return true;
  }
  event(connection, event) {
    if (connection !== this.connection || (this.state && event.version <= this.state.version)) return;
    if (this.buffer.size >= 64) { this.buffer.clear(); this.ready = false; this.needsSnapshot = true; return; }
    this.buffer.set(event.version, event); if (this.ready) this.drain();
  }
  drain() {
    let next;
    while ((next = this.buffer.get(this.state.version + 1))) {
      if (next.epoch !== this.state.epoch) { this.needsSnapshot = true; return; }
      this.state = structuredClone(next.snapshot); this.buffer.delete(next.version);
    }
    this.needsSnapshot = this.buffer.size > 0;
  }
}
