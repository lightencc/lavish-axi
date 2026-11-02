// Prepared for the explicitly reviewed loopback-listener step. Not yet executed.
import { createServer } from 'node:http';
import { mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startPeer } from './peer.js';
import { Bridge, handle } from './bridge.js';

const root = resolve('verification/polish-pi-m0');
const run = join(root, 'runtime', randomUUID());
mkdirSync(join(run, 'workspace'), { recursive: true, mode: 0o700 });
const log = (kind, data) => appendFileSync(join(run, 'web-events.jsonl'), JSON.stringify({ at: new Date().toISOString(), kind, data }) + '\n', { mode: 0o600 });
const peer = startPeer(run, log);
let server, bridge, lifetime, stopping = false;
async function stop() {
  if (stopping) return; stopping = true; clearTimeout(lifetime);
  server?.close(); server?.closeAllConnections(); bridge?.close(); peer.child.stdin.end();
  const fallback = setTimeout(() => peer.child.kill('SIGTERM'), 1500);
  await peer.exited; clearTimeout(fallback);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
try {
  const ready = await peer.ready;
  const state = await peer.rpc({ type: 'get_state' });
  if (state.data.sessionId !== ready.binding.session) throw new Error('BINDING_MISMATCH');
  log('before_web_bind', { pid: peer.child.pid, binding: ready.binding });
  bridge = new Bridge(join(run, 'bridge'), ready.binding, (op, data) => peer.command(op, data));
  server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (req.headers.host !== '127.0.0.1:49793') { res.writeHead(403); res.end(); return; }
      if (req.method === 'GET' && ['/', '/page.js'].includes(req.url)) {
        res.setHeader('Content-Type', req.url === '/' ? 'text/html; charset=utf-8' : 'application/javascript');
        res.end(readFileSync(join(root, req.url === '/' ? 'index.html' : 'page.js'))); return;
      }
      let body = ''; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 16000) { res.writeHead(413); res.end(); return; } body += chunk; }
      const request = new Request('http://127.0.0.1:49793' + req.url, { method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body } : {}) });
      const result = await handle(request, bridge);
      res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(await result.text());
    } catch (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
  });
  server.on('error', error => { log('listener_error', { code: error.code }); void stop(); });
  server.listen(49793, '127.0.0.1', () => {
    log('listening', { address: '127.0.0.1:49793', binding: ready.binding });
    console.log(`Pi M0: http://127.0.0.1:49793 · evidence ${run}`);
  });
  lifetime = setTimeout(stop, 10 * 60 * 1000);
  void peer.exited.then(stop);
} catch (error) { log('startup_error', { error: error.message }); await stop(); process.exitCode = 1; }
