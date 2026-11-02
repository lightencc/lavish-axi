import { Inbox } from './inbox.js';

export class Bridge {
  constructor(dir, binding, command) {
    this.box = new Inbox(dir, binding); this.binding = binding; this.command = command;
  }
  validate(value, id) {
    const r = this.box.get(id);
    if (!value || value.id !== id || value.binding?.instance !== this.binding.instance || value.binding?.session !== this.binding.session || (value.state !== 'no_record' && value.digest !== r.digest)) throw new Error('HOST_IDENTITY_MISMATCH');
    this.box.change(data => { data.messages.find(x => x.id === id).hostEvidence = value; });
    return value;
  }
  async submit(message) {
    const { fresh, record } = this.box.admit(message);
    if (!fresh) return this.query(record.id);
    this.box.dispatch(record.id);
    try { return this.validate(await this.command('admit', { message }), record.id); }
    catch (error) { return { id: record.id, state: 'delivery_unknown', error: error.message, safeToResend: false }; }
  }
  async query(id) {
    if (!this.box.get(id)) throw new Error('NOT_FOUND');
    return this.validate(await this.command('query', { id }), id);
  }
  close() { this.box.close(); }
}

export async function handle(request, bridge) {
  const origin = 'http://127.0.0.1:49793';
  const json = (status, data) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.headers.get('host') !== '127.0.0.1:49793' || request.headers.has('x-forwarded-host')) return json(403, { error: 'HOST_REJECTED' });
  if (request.headers.has('origin') && request.headers.get('origin') !== origin) return json(403, { error: 'ORIGIN_REJECTED' });
  try {
    if (request.headers.has('referer') && new URL(request.headers.get('referer')).origin !== origin) return json(403, { error: 'REFERER_REJECTED' });
  } catch { return json(403, { error: 'REFERER_REJECTED' }); }
  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && url.pathname === '/binding') return json(200, bridge.binding);
    if (request.method === 'POST' && url.pathname === '/submit') {
      if (request.headers.get('origin') !== origin) return json(403, { error: 'ORIGIN_REQUIRED' });
      const body = await request.text();
      if (Buffer.byteLength(body) > 16000) return json(413, { error: 'TOO_LARGE' });
      return json(200, await bridge.submit(JSON.parse(body)));
    }
    if (request.method === 'GET' && url.pathname === '/query') return json(200, await bridge.query(url.searchParams.get('id')));
    return json(404, { error: 'NOT_FOUND' });
  } catch (error) { return json(error.message === 'CONFLICT' ? 409 : 400, { error: error.message }); }
}
