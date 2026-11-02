import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export function startCoordinator(dir, binding, host, log = () => {}) {
  const child = fork(new URL('./coordinator-child.js', import.meta.url), [dir, JSON.stringify(binding)], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const pending = new Map(), subscribers = new Set();
  let resolveReady, rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  const readyTimeout = setTimeout(() => rejectReady(new Error('COORDINATOR_TIMEOUT')), 10000);
  child.on('message', msg => {
    log('coordinator', { pid: child.pid, ...msg });
    if (msg.type === 'ready') { clearTimeout(readyTimeout); resolveReady(msg); }
    if (msg.type === 'event') for (const f of subscribers) f(msg.event);
    if (msg.type === 'result') {
      const p = pending.get(msg.id); if (!p) return;
      clearTimeout(p.timeout); pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.value);
    }
    if (msg.type === 'host') {
      Promise.resolve().then(() => host(msg.message, msg.token)).then(
        proof => { if (child.connected) child.send({ type: 'host-result', id: msg.id, proof }); },
        error => { if (child.connected) child.send({ type: 'host-result', id: msg.id, error: error.message }); },
      );
    }
  });
  child.stderr.on('data', chunk => log('coordinator-stderr', { pid: child.pid, text: String(chunk) }));
  child.on('error', error => { clearTimeout(readyTimeout); rejectReady(error); });
  const exited = new Promise(resolve => child.on('exit', (code, signal) => {
    clearTimeout(readyTimeout); rejectReady(new Error('COORDINATOR_EXIT'));
    for (const p of pending.values()) { clearTimeout(p.timeout); p.reject(new Error('COORDINATOR_EXIT')); } pending.clear();
    log('coordinator-exit', { pid: child.pid, code, signal }); resolve({ code, signal });
  }));
  return { child, ready, exited,
    subscribe(f) { subscribers.add(f); return () => subscribers.delete(f); },
    call(op, data) { return new Promise((resolve, reject) => {
      if (!child.connected) { reject(new Error('COORDINATOR_EXIT')); return; }
      const id = randomUUID();
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('COORDINATOR_RESULT_UNKNOWN')); }, 25000);
      pending.set(id, { resolve, reject, timeout }); child.send({ id, op, data });
    }); },
  };
}
