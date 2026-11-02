// Adapter is supplied by the supervisor. Unit-test adapters are not Pi proof.
export async function drainAccepted(authority, submit) {
  for (;;) {
    const snapshot = authority.snapshot();
    if (snapshot.lifecycle === 'ended' || snapshot.messages.some(m => ['dispatching', 'host_queued', 'unknown'].includes(m.state))) return snapshot;
    const message = snapshot.messages.find(m => m.state === 'accepted');
    if (!message) return snapshot;
    const token = authority.claim(snapshot.mode, message.id);
    let proof;
    try { proof = await submit(message, token); }
    catch { authority.uncertain(token); return authority.snapshot(); }
    authority.record(token, proof);
  }
}
