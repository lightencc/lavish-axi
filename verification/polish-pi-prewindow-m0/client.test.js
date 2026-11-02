// Execute the shipped client, replacing only browser/network boundaries. No TCP listener.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

const source = await readFile(new URL('./page.js', import.meta.url), 'utf8');
const binding = { artifact: 'client-fixture.html', instance: 'owned-client-fixture', session: 'owned-session' };
const snapshot = (version = 4, state = 'replied', lifecycle = 'open') => ({
  binding, epoch: 1, version, lifecycle,
  messages: [{ id: 'r2-client-message', text: 'Whole-page feedback', kind: 'message', state, consumed: state !== 'accepted' }],
});

class Element {
  textContent = '';
  value = '';
  disabled = false;
  dataset = {};
  children = [];
  listeners = new Map();
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  replaceChildren() { this.children = []; }
  append(child) { this.children.push(child); }
  fire(type) { this.listeners.get(type)?.({ preventDefault() {} }); }
}

async function fixture({ initial = snapshot(), failQueries = 1 } = {}) {
  const elements = new Map(['status', 'notice', 'send', 'end', 'messages', 'text', 'composer', 'refresh'].map(id => [id, new Element()]));
  const storage = new Map(), calls = [], sources = [];
  let currentSnapshot = initial, queries = 0;
  class EventSource {
    constructor(url) { this.url = url; sources.push(this); }
    close() { this.closed = true; }
  }
  const context = vm.createContext({
    document: { getElementById: id => elements.get(id), createElement: () => new Element() },
    window: { addEventListener() {} },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    EventSource,
    performance: { now: () => 123 },
    crypto: { randomUUID },
    fetch: async (path, options) => {
      calls.push({ path, method: options?.method ?? 'GET', body: options?.body ? JSON.parse(options.body) : null });
      if (path === '/snapshot') return { ok: true, json: async () => structuredClone(currentSnapshot) };
      if (path === '/query') {
        queries++;
        if (queries <= failQueries) throw new Error('INJECTED_QUERY_DISCONNECT');
        return { ok: true, json: async () => ({ status: 'verified', reply: { text: 'Recovered exact reply' } }) };
      }
      throw new Error('Unexpected request: ' + path);
    },
  });
  // Wrapping permits the actual module's top-level await without changing its logic.
  await new vm.Script(`(async () => {\n${source}\n})()`, { filename: 'actual-page.js' }).runInContext(context);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  return {
    elements, calls, source: sources[0], flush,
    setSnapshot(value) { currentSnapshot = value; },
    queryCalls() { return calls.filter(c => c.path === '/query'); },
    rendered() { return elements.get('messages').children.map(child => ({ state: child.dataset.state, text: child.textContent })); },
    assertNoResubmit() { assert.equal(calls.some(c => ['/submit', '/end'].includes(c.path)), false, 'reply recovery must not resubmit user input'); },
  };
}

test('actual client retries missing reply after first query failure and same-version manual snapshot', async () => {
  const f = await fixture();
  assert.equal(f.queryCalls().length, 1);
  assert.match(f.elements.get('notice').textContent, /INJECTED_QUERY_DISCONNECT/);
  assert.doesNotMatch(f.rendered()[0].text, /Recovered exact reply/);
  f.elements.get('refresh').fire('click');
  await f.flush();
  assert.equal(f.queryCalls().length, 2, 'same state version must still fill an absent reply cache entry');
  assert.match(f.rendered()[0].text, /Recovered exact reply/);
  assert.deepEqual(f.queryCalls()[0].body, f.queryCalls()[1].body, 'recovery must query the same binding, epoch and message');
  f.elements.get('refresh').fire('click');
  await f.flush();
  assert.equal(f.queryCalls().length, 2, 'a cached reply does not need another query');
  f.assertNoResubmit();
});

test('actual client rejects stale SSE state without rolling replied/ended UI back to accepted/open', async () => {
  const f = await fixture({ initial: snapshot(8, 'replied', 'ended'), failQueries: 0 });
  assert.match(f.rendered()[0].text, /Recovered exact reply/);
  assert.equal(f.elements.get('send').disabled, true);
  f.source.onmessage({ data: JSON.stringify(snapshot(7, 'accepted', 'open')) });
  await f.flush();
  assert.equal(f.rendered()[0].state, 'replied');
  assert.match(f.rendered()[0].text, /Recovered exact reply/);
  assert.equal(f.elements.get('send').disabled, true);
  assert.match(f.elements.get('status').textContent, /通信已结束/);
  assert.equal(f.queryCalls().length, 1);
  f.assertNoResubmit();
});

test('actual client reconnect fills missing reply from same-version SSE snapshot without submitting again', async () => {
  const f = await fixture();
  f.source.onerror();
  assert.match(f.elements.get('status').textContent, /连接中断/);
  f.source.onopen();
  f.source.onmessage({ data: JSON.stringify(snapshot()) });
  await f.flush();
  assert.equal(f.queryCalls().length, 2, 'reconnected same-version snapshot must retry the failed reply read');
  assert.match(f.rendered()[0].text, /Recovered exact reply/);
  assert.doesNotMatch(f.elements.get('status').textContent, /连接中断/);
  f.assertNoResubmit();
});
