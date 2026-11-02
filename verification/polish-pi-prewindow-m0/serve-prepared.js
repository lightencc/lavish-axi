// Prepared only: no top-level launch. The sole real bind is inside startPreview().
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import express from 'express';
import { startPeer } from './peer.js';
import { createRuntime } from './runtime.js';
import { createHandler, ORIGIN } from './web.js';
import { openWindow, listenPreview } from './window.js';

export async function startPreview() {
  const run = join(fileURLToPath(new URL('./runtime/', import.meta.url)), randomUUID());
  mkdirSync(join(run, 'workspace'), { recursive: true, mode: 0o700 });
  writeFileSync(join(run, 'fixture.html'), '<!doctype html><title>Polish Pi M0</title>');
  const log = (kind, data) => appendFileSync(join(run, 'web-events.jsonl'), JSON.stringify({ at: Date.now(), kind, data }) + '\n');
  let runtime, peer, activeInput, firstTextSeen;
  const window = await openWindow({ log,
    startHost() {
      peer = startPeer(run, (kind, data) => {
        log(kind, data);
        if (kind === 'host' && data.kind === 'proof' && data.result.proof) {
          if (data.result.proof.kind === 'consumed') { activeInput = data.result.proof.id; firstTextSeen = false; }
          void runtime?.call('reconcile', data.result.proof).catch(error => log('reconcile-error', { message: error.message }));
        }
      });
      let rest = '';
      peer.child.stdout.on('data', chunk => {
        const lines = (rest + chunk).split('\n'); rest = lines.pop();
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line);
          if (activeInput && !firstTextSeen && event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
            firstTextSeen = true; log('first-text-token', { id: activeInput });
          }
        }
      });
      return { ...peer, async stop() {
        if (peer.child.exitCode === null && peer.child.signalCode === null) peer.child.kill('SIGTERM');
        const killer = setTimeout(() => { if (peer.child.exitCode === null && peer.child.signalCode === null) peer.child.kill('SIGKILL'); }, 2000);
        await peer.exited; clearTimeout(killer); log('host-cleanup', { pid: peer.child.pid });
      } };
    },
    async openReview(_peer, ready) {
      runtime = await createRuntime(run, ready.binding, async (message, token) => {
        log('dispatch-to-host', { id: message.id, attempt: token.attempt });
        const details = { ...ready.binding, id: message.id, epoch: message.epoch, digest: message.digest, attempt: token.attempt };
        const result = await peer.command('admit', { message: { text: message.text, details } });
        if (!result.proof) throw new Error('HOST_RESULT_UNKNOWN'); return result.proof;
      }, log);
      await peer.command('pause', { value: false });
      const identity = await peer.command('identity', {});
      if (identity.pid !== ready.pid || identity.session !== ready.binding.session || identity.binding.instance !== ready.binding.instance) throw new Error('BINDING');
      log('binding-before-listen', identity); return runtime;
    },
    async bindWindow(review) {
      const app = express();
      const handler = createHandler(review, details => peer.command('query', { details }));
      app.use((req, res, next) => {
        if (req.get('host') !== '127.0.0.1:49793') { res.status(403).end(); return; }
        try {
          for (const name of ['origin', 'referer']) if (req.get(name) && new URL(req.get(name)).origin !== ORIGIN) { res.status(403).end(); return; }
        } catch { res.status(403).end(); return; }
        next();
      });
      const scope = (req, res, next) => {
        if (!['GET', 'POST'].includes(req.method)) { res.status(405).end(); return; }
        if (req.query.file !== review.binding.artifact) { res.status(403).json({ error: 'ARTIFACT_SCOPE' }); return; }
        next();
      };
      app.get('/api/poll', scope, review.pollHandler);
      app.post('/api/poll', scope, express.json({ limit: '24kb' }), review.pollHandler);
      app.use(async (req, res, next) => {
        const abort = new AbortController(); res.on('close', () => abort.abort());
        try {
          const chunks = []; let bytes = 0;
          for await (const chunk of req) { bytes += chunk.length; if (bytes <= 24000) chunks.push(chunk); }
          if (bytes > 24000) { res.status(413).end(); return; }
          const body = Buffer.concat(chunks);
          log('http-request', { path: req.url, method: req.method });
          const request = new Request(ORIGIN + req.url, { method: req.method, headers: req.headers, signal: abort.signal, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body }) });
          const response = await handler(request);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          if (response.body) {
            const stream = Readable.fromWeb(response.body);
            stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
          } else res.end();
        } catch (error) { next(error); }
      });
      app.use((error, _req, res, _next) => { log('http-error', { message: error.message }); if (!res.headersSent) res.status(409).json({ error: error.message }); else res.destroy(); });
      const server = createServer(app);
      const listener = await listenPreview(server);
      log('listening', { origin: ORIGIN, expiresAfterMs: 600000 });
      return { ...listener, close: async () => { await listener.close(); log('listener-closed', { origin: ORIGIN }); } };
    },
  });
  const stop = async () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); await window.stop(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return { origin: ORIGIN, run, binding: runtime.binding, runtime, stop };
}
