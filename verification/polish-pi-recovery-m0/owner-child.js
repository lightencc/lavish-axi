// Local IPC-only failure fixture. No Pi and no model calls.
import { Authority } from './authority.js';
import { randomUUID } from 'node:crypto';
const [dir, mode, consumer] = process.argv.slice(2);
if (mode === 'consumer') {
  process.on('message', () => process.disconnect());
  process.send({ kind: 'claim', mode: consumer });
} else {
  const a = new Authority(dir, { artifact: 'm0-artifact', instance: 'owned-pi', session: 'owned-session' });
  const id = 'r1-' + randomUUID(); a.admit({ id, text: 'new isolated local fixture', epoch: 1 });
  if (mode === 'ending') a.beginEnd({ id: 'end-' + randomUUID(), epoch: 1, final: null });
  const token = mode === 'dispatch' ? a.claim('bridge', id) : null;
  process.send({ nonce: a.nonce, token, snapshot: a.snapshot() });
  // Intentionally remain alive until the owning test supervisor injects SIGKILL.
  process.on('message', () => {});
}
