// Pure Request/Response interface. Importing this module never binds a port.
import { readFileSync } from 'node:fs';
export const ORIGIN = 'http://127.0.0.1:49793';
const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('./page.js', import.meta.url), 'utf8');
const publicSnapshot = s => ({ binding: s.binding, epoch: s.epoch, version: s.version, lifecycle: s.lifecycle,
  messages: s.messages.map(m => ({ id: m.id, text: m.text, kind: m.kind, state: m.state, consumed: m.consumed, executionUnknown: m.executionUnknown })) });
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const only = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every(k => keys.includes(k));
const validMessage = m => only(m, ['id', 'text', 'epoch']) && /^r2-[a-z0-9-]{1,90}$/.test(m.id) && typeof m.text === 'string' && m.text.trim() && m.text.length <= 20000;

export function createHandler(coordinator, queryHost) {
  return async request => {
    try {
      const url = new URL(request.url);
      if (url.origin !== ORIGIN) return json({ error: 'HOST' }, 403);
      for (const h of ['origin', 'referer']) {
        const v = request.headers.get(h);
        if (v && new URL(v).origin !== ORIGIN) return json({ error: 'ORIGIN' }, 403);
      }
      if (request.method === 'GET' && ['/', '/page.js'].includes(url.pathname)) return new Response(url.pathname === '/' ? page : script, {
        headers: { 'Content-Type': url.pathname === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store',
          'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" },
      });
      const getPaths = ['/binding', '/snapshot', '/events'], postPaths = ['/submit', '/query', '/end'];
      if (![...getPaths, ...postPaths].includes(url.pathname)) return json({ error: 'NOT_FOUND' }, 404);
      if (request.method !== (getPaths.includes(url.pathname) ? 'GET' : 'POST')) return json({ error: 'METHOD' }, 405);
      if (url.pathname === '/events') {
        let cleanup = () => {}, heartbeat, closed = false;
        const body = new ReadableStream({
          async start(controller) {
            const emit = s => { if (!closed) controller.enqueue(new TextEncoder().encode(`id: ${s.version}\ndata: ${JSON.stringify(publicSnapshot(s))}\n\n`)); };
            const unsubscribe = coordinator.subscribe(event => emit(event.snapshot));
            const abort = () => { if (closed) return; closed = true; cleanup(); controller.close(); };
            cleanup = () => { unsubscribe(); clearInterval(heartbeat); request.signal.removeEventListener('abort', abort); };
            request.signal.addEventListener('abort', abort, { once: true });
            if (request.signal.aborted) { abort(); return; }
            try {
              emit(await coordinator.call('snapshot'));
              if (!closed) heartbeat = setInterval(() => controller.enqueue(new TextEncoder().encode(': heartbeat\n\n')), 15000);
            } catch (error) { closed = true; cleanup(); controller.error(error); }
          },
          cancel() { closed = true; cleanup(); },
        });
        return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
      }
      const snapshot = await coordinator.call('snapshot');
      if (url.pathname === '/binding') return json({ binding: snapshot.binding, epoch: snapshot.epoch });
      if (url.pathname === '/snapshot') return json(publicSnapshot(snapshot));
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON_REQUIRED' }, 415);
      const raw = await request.text(); if (raw.length > 24000) return json({ error: 'TOO_LARGE' }, 413);
      const data = JSON.parse(raw);
      if (!['artifact', 'instance', 'session'].every(k => data.binding?.[k] === snapshot.binding[k]) || data.epoch !== snapshot.epoch) return json({ error: 'BINDING_OR_EPOCH' }, 409);
      if (url.pathname === '/query') {
        if (!only(data, ['binding', 'epoch', 'id'])) return json({ error: 'INVALID' }, 400);
        const m = snapshot.messages.find(m => m.id === data.id);
        if (!m?.claim) return json({ status: 'unknown', safeToResend: false });
        const result = await queryHost({ ...snapshot.binding, id: m.id, epoch: m.epoch, digest: m.digest, attempt: m.claim.attempt });
        return json({ status: result.status, safeToResend: false, reply: result.reply ?? null });
      }
      if (url.pathname === '/submit') {
        if (!only(data, ['binding', 'epoch', 'id', 'text', 'scope']) || data.scope !== 'session' || !validMessage({ id: data.id, text: data.text, epoch: data.epoch })) return json({ error: 'INVALID' }, 400);
        await coordinator.call('admit', { id: data.id, text: data.text, epoch: data.epoch });
      } else {
        if (!only(data, ['binding', 'epoch', 'id', 'final']) || !/^r2-[a-z0-9-]{1,83}$/.test(data.id) ||
          (data.final != null && (!validMessage(data.final) || data.final.epoch !== data.epoch))) return json({ error: 'INVALID' }, 400);
        await coordinator.call('end', { id: data.id, epoch: data.epoch, final: data.final ?? null });
      }
      return json(publicSnapshot(await coordinator.call('snapshot')));
    } catch (error) { return json({ error: error.message }, ['CLOSED', 'CONFLICT', 'EPOCH'].includes(error.message) ? 409 : 400); }
  };
}
