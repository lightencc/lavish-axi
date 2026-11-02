// One SessionStore is the authority for both the actual poll handler and bridge.
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { SessionStore } from '../../src/session-store.js';
import { AsyncMutex } from '../../src/async-mutex.js';
import { createPollHandler, restoreClaimedFeedback } from '../../src/server.js';

export async function createRuntime(run, binding, host, log = () => {}) {
  const store = new SessionStore(join(run, 'state.json'));
  const session = await store.upsertSession(binding.artifact, 'http://127.0.0.1:49793/');
  const key = session.key, subscribers = new Set(), events = new EventEmitter(), activePolls = new Map();
  await store.bindFeedback(key, binding);
  let closed = false, pumping = false, again = false;
  const snapshot = () => store.feedbackSnapshot(key);
  async function publish() {
    const s = await snapshot();
    log('snapshot', s);
    for (const fn of subscribers) { try { fn({ version: s.version, epoch: s.epoch, snapshot: s }); } catch { subscribers.delete(fn); } }
    events.emit('feedback', key);
    return s;
  }
  async function deliver(result) {
    if (!result.delivery || closed) throw new Error('DELIVERY_UNAVAILABLE');
    const m = (await snapshot()).messages.find(m => m.id === result.delivery.id);
    // Re-read the durable attempt before any external call, including poll responses.
    if (m.state !== 'dispatching' || m.claim.attempt !== result.delivery.attempt || m.claim.generation !== result.delivery.generation) throw new Error('STALE');
    await store.reserveFeedbackHost(key, result.delivery);
    try {
      const proof = await host(m, result.delivery);
      if (!closed) await store.recordFeedback(key, result.delivery, proof);
    } catch (error) {
      if (!closed) await store.markFeedbackUnknown(key, result.delivery);
      log('delivery-unknown', { id: m.id, error: error.message });
    }
    await publish();
  }
  async function pump() {
    if (pumping) { again = true; return; }
    pumping = true;
    try {
      do {
        again = false;
        while (!closed && (await snapshot()).mode === 'bridge') {
          const result = await store.takeFeedback(key, await store.feedbackLease(key, 'bridge'));
          if (result.status !== 'feedback') break;
          await publish(); await deliver(result);
        }
      } while (again && !closed);
    } finally { pumping = false; }
  }
  const runtime = {
    store, key, binding, snapshot, deliver,
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    async call(op, data) {
      if (closed && op !== 'snapshot') throw new Error('CLOSED');
      if (op === 'snapshot') return snapshot();
      if (op === 'admit') {
        if (data.epoch !== (await snapshot()).epoch) throw new Error('EPOCH');
        const result = await store.queuePrompts(key, { prompts: [{ prompt_id: data.id, prompt: data.text }] });
        if (result.ended) throw new Error('CLOSED');
      } else if (op === 'end') await store.beginFeedbackEnd(key, data);
      else if (op === 'reconcile') await store.reconcileFeedback(key, data);
      else if (op === 'mode') await store.setFeedbackMode(key, data.mode);
      else if (op === 'recover') await store.recoverFeedback(key);
      else throw new Error('UNSUPPORTED');
      await publish(); await pump(); return snapshot();
    },
    async close() {
      if (closed) return;
      closed = true;
      await store.recoverFeedback(key);
      events.emit('browser-disconnected', key); subscribers.clear();
    },
  };
  runtime.pollHandler = createPollHandler({ store, activePolls, events, pollOwnershipLock: new AsyncMutex(),
    deliveredFeedback: new Set(), allowedHostnames: new Set(['127.0.0.1']), allowAnyHostname: false,
    publishAgentReply: (k, text) => store.addAgentReply(k, text),
    restoreClosedFeedback: async (k, result) => { await restoreClaimedFeedback(store, k, result); await publish(); },
    finishFeedbackDelivery: () => {}, refreshIdleTimer: () => {}, clearBrowserDisconnectTimer: () => {},
    browserDisconnectPending: new Set(), pollHeartbeatMs: 15000,
  });
  return runtime;
}
