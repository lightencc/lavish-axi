// Prepared only. No top-level launch. Invoke startPreview() only for a newly authorized web test.
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { startPeer } from './peer.js';
import { startCoordinator } from './coordinator-peer.js';
import { createHandler, ORIGIN } from './web.js';

export async function startPreview() {
  const run = join(fileURLToPath(new URL('./runtime/', import.meta.url)), randomUUID());
  mkdirSync(join(run, 'workspace'), { recursive: true, mode: 0o700 });
  writeFileSync(join(run, 'fixture.html'), '<!doctype html><title>Polish Pi M0</title>');
  const log = (kind, data) => appendFileSync(join(run, 'web-events.jsonl'), JSON.stringify({ at: Date.now(), kind, data }) + '\n');
  let coordinator, server, deadline, closing, binding, activeInput, firstTextSeen;
  const sockets = new Set();
  const peer = startPeer(run, (kind, data) => {
    log(kind, data);
    if (kind === 'host' && data.kind === 'proof' && data.result.proof) {
      if (data.result.proof.kind === 'consumed') { activeInput = data.result.proof.id; firstTextSeen = false; }
      void coordinator?.call('reconcile', data.result.proof).catch(error => { log('reconcile-error', { message: error.message }); void stop(); });
    }
    if (kind === 'host' && data.kind === 'fatal') void stop();
  });
  let rest = '';
  peer.child.stdout.on('data', chunk => {
    const lines = (rest + chunk).split('\n'); rest = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const e = JSON.parse(line);
      if (activeInput && !firstTextSeen && e.type === 'message_update' && e.assistantMessageEvent?.type === 'text_delta') {
        firstTextSeen = true; log('first-text-token', { id: activeInput });
      }
    }
  });
  async function stop() {
    if (closing) return closing;
    closing = (async () => {
      clearTimeout(deadline);
      process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
      if (server) { const closed = new Promise(resolve => server.close(resolve)); for (const socket of sockets) socket.destroy(); await closed; }
      if (coordinator?.child.connected) {
        // Close request is serialized behind an in-flight host call. Bound cleanup independently.
        const killer = setTimeout(() => coordinator.child.kill('SIGTERM'), 2000);
        try { await coordinator.call('close'); } catch { /* Preserve unclean state for inspection. */ }
        clearTimeout(killer);
      }
      if (coordinator) await coordinator.exited;
      if (peer.child.exitCode === null && peer.child.signalCode === null) peer.child.kill('SIGTERM');
      await peer.exited;
      log('cleanup', { piPid: peer.child.pid, coordinatorPid: coordinator?.child.pid, origin: ORIGIN });
    })();
    return closing;
  }
  function onSignal() { void stop(); }
  try {
    const ready = await peer.ready; binding = ready.binding;
    coordinator = startCoordinator(join(run, 'authority'), binding, async (message, token) => {
      log('dispatch-to-host', { id: message.id, attempt: token.attempt });
      const result = await peer.command('admit', { message: { text: message.text, details: { ...binding, id: message.id, epoch: message.epoch, digest: message.digest, attempt: token.attempt } } });
      if (!result.proof) throw new Error('HOST_RESULT_UNKNOWN'); return result.proof;
    }, log);
    await coordinator.ready; await coordinator.call('start');
    await peer.command('pause', { value: false });
    log('binding-before-listen', await peer.command('identity', {}));
    const handler = createHandler(coordinator, details => peer.command('query', { details }));
    server = createServer(async (req, res) => {
      const abort = new AbortController(); res.on('close', () => abort.abort());
      try {
        if (req.headers.host !== '127.0.0.1:49793') { res.writeHead(403).end(); return; }
        const chunks = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes <= 24000) chunks.push(chunk); }
        if (bytes > 24000) { res.writeHead(413).end(); return; }
        const body = Buffer.concat(chunks);
        log('http-request', { path: req.url, method: req.method });
        const request = new Request(ORIGIN + req.url, { method: req.method, headers: req.headers, signal: abort.signal, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body }) });
        const response = await handler(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        if (response.body) {
          const stream = Readable.fromWeb(response.body);
          stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
        } else res.end();
      } catch (error) { log('http-error', { message: error.message }); if (!res.headersSent) res.writeHead(500); res.end(); }
    });
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(49793, '127.0.0.1', resolve); });
    server.on('error', error => { log('server-error', { message: error.message }); void stop(); });
    log('listening', { origin: ORIGIN, expiresAfterMs: 600000 });
    deadline = setTimeout(() => { void stop(); }, 600000);
    process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
    void peer.exited.then(() => stop());
    void coordinator.exited.then(() => stop());
    return { origin: ORIGIN, run, binding, stop };
  } catch (error) { await stop(); throw error; }
}
