import { randomUUID } from 'node:crypto';
import { Authority } from '../polish-pi-recovery-m0/authority.js';
import { drainAccepted } from '../polish-pi-recovery-m0/drain.js';

const [dir, bindingJson] = process.argv.slice(2);
const authority = new Authority(dir, JSON.parse(bindingJson));
const pending = new Map();
let started = false, serial = Promise.resolve();
const send = data => process.send?.(data);
authority.subscribe(event => send({ type: 'event', event }));
function submit(message, token) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('HOST_RESULT_UNKNOWN')); }, 18000);
    pending.set(id, { resolve, reject, timeout });
    send({ type: 'host', id, message, token });
  });
}
process.on('message', msg => {
  if (msg.type === 'host-result') {
    const request = pending.get(msg.id); if (!request) return;
    pending.delete(msg.id); clearTimeout(request.timeout);
    if (msg.error) request.reject(new Error(msg.error)); else request.resolve(msg.proof);
    return;
  }
  serial = serial.then(async () => {
    try {
      let value;
      const d = msg.data;
      if (msg.op === 'admit') value = authority.admit(d);
      else if (msg.op === 'start') started = true;
      else if (msg.op === 'snapshot') value = authority.snapshot();
      else if (msg.op === 'claim') value = authority.claim(d.mode, d.id);
      else if (msg.op === 'record') authority.record(d.token, d.proof);
      else if (msg.op === 'reconcile') authority.reconcile(d);
      else if (msg.op === 'mode') authority.switchMode(d.mode);
      else if (msg.op === 'end') authority.beginEnd(d);
      else if (msg.op === 'close') { started = false; authority.close(); }
      else throw new Error('UNSUPPORTED');
      if (started && ['start', 'admit', 'reconcile', 'end'].includes(msg.op)) await drainAccepted(authority, submit);
      send({ type: 'result', id: msg.id, value: value ?? authority.snapshot() });
      if (msg.op === 'close') process.disconnect();
    } catch (error) { send({ type: 'result', id: msg.id, error: error.message }); }
  });
});
send({ type: 'ready', pid: process.pid, nonce: authority.nonce, snapshot: authority.snapshot() });
