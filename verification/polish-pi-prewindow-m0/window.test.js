// Lifecycle tests use explicit fake host/bind/timers; no TCP or real child is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openWindow, listenPreview } from './window.js';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('actual bind adapter uses only fixed loopback/port and closes its server on EADDRINUSE', async () => {
  const calls = [];
  const server = Object.assign(new EventEmitter(), {
    listen(port, host) { calls.push(['listen', port, host]); queueMicrotask(() => this.emit('error', Object.assign(new Error('occupied'), { code: 'EADDRINUSE' }))); },
    close(done) { calls.push(['close']); done(); },
  });
  await assert.rejects(listenPreview(server), { code: 'EADDRINUSE' });
  assert.deepEqual(calls, [['listen', 49793, '127.0.0.1'], ['close']]);
});

test('actual bind cleanup destroys streaming sockets and exposes terminal signal once', async () => {
  let closes = 0, destroys = 0;
  const server = Object.assign(new EventEmitter(), {
    listen(_port, _host, ready) { ready(); },
    close(done) { closes++; queueMicrotask(done); },
  });
  const listener = await listenPreview(server);
  const socket = Object.assign(new EventEmitter(), { destroy() { destroys++; this.emit('close'); } });
  server.emit('connection', socket);
  await Promise.all([listener.close(), listener.close(), listener.exited]);
  assert.equal(closes, 1); assert.equal(destroys, 1);
});

function fixture({ ready = true, pendingBind = false, bindError = null } = {}) {
  const calls = [], scheduled = [], cleared = [];
  const hostReady = deferred(), hostExit = deferred(), reviewExit = deferred(), bindResult = deferred();
  const identity = { pid: 12345, binding: { artifact: 'owned-fixture.html', instance: 'owned-host', session: 'owned-session' } };
  const peer = {
    ready: hostReady.promise, exited: hostExit.promise,
    async stop() { calls.push('host.close'); hostExit.resolve({ code: 0 }); },
  };
  const review = {
    exited: reviewExit.promise,
    async close() { calls.push('review.close'); reviewExit.resolve({ code: 0 }); },
  };
  const listener = { async close() { calls.push('listener.close'); } };
  if (ready) hostReady.resolve(identity);
  const options = {
    startHost() { calls.push('host.start'); return peer; },
    async openReview(actualPeer, actualIdentity) {
      assert.equal(actualPeer, peer); assert.equal(actualIdentity, identity);
      calls.push('review.open'); return review;
    },
    async bindWindow(actualReview) {
      assert.equal(actualReview, review); calls.push('bind');
      if (bindError) throw bindError;
      return pendingBind ? bindResult.promise : listener;
    },
    timers: {
      setTimeout(fn, ms) { const timer = { fn, ms }; scheduled.push(timer); return timer; },
      clearTimeout(timer) { cleared.push(timer); },
    },
    log() {},
  };
  return { options, calls, scheduled, cleared, identity, peer, review, listener, hostReady, hostExit, reviewExit, bindResult };
}

test('window waits for owned host identity before review and bind; schedules exactly 600000 ms after bind', { timeout: 2000 }, async () => {
  const f = fixture({ ready: false, pendingBind: true });
  const opening = openWindow(f.options);
  await flush();
  assert.deepEqual(f.calls, ['host.start']);
  assert.equal(f.scheduled.length, 0);
  f.hostReady.resolve(f.identity);
  await flush();
  assert.deepEqual(f.calls, ['host.start', 'review.open', 'bind']);
  assert.equal(f.scheduled.length, 0, 'deadline begins only after successful bind');
  f.bindResult.resolve(f.listener);
  const window = await opening;
  assert.equal(f.scheduled.length, 1); assert.equal(f.scheduled[0].ms, 600000);
  await window.stop();
});

test('EADDRINUSE stops only the owned startup; no retry or alternate binding', { timeout: 2000 }, async () => {
  const failure = Object.assign(new Error('port occupied by another process'), { code: 'EADDRINUSE' });
  const f = fixture({ bindError: failure });
  await assert.rejects(openWindow(f.options), error => error === failure);
  assert.deepEqual(f.calls, ['host.start', 'review.open', 'bind', 'review.close', 'host.close']);
  assert.equal(f.scheduled.length, 0);
});

test('deadline closes listener then review then host; concurrent repeated stop is idempotent', { timeout: 2000 }, async () => {
  const f = fixture();
  const window = await openWindow(f.options);
  f.scheduled[0].fn();
  await flush();
  assert.deepEqual(f.calls.slice(3), ['listener.close', 'review.close', 'host.close'], 'deadline itself must trigger cleanup');
  await Promise.all([window.stop(), window.stop(), window.stop()]);
  assert.deepEqual(f.calls.slice(3), ['listener.close', 'review.close', 'host.close']);
  assert.ok(f.cleared.includes(f.scheduled[0]));
});

test('host exit closes the active listener and review without waiting for deadline', { timeout: 2000 }, async () => {
  const f = fixture();
  const window = await openWindow(f.options);
  f.hostExit.resolve({ code: 1 });
  await flush();
  assert.deepEqual(f.calls.slice(3), ['listener.close', 'review.close', 'host.close']);
  await window.stop();
  assert.equal(f.calls.filter(c => c === 'host.close').length, 1);
});

test('review child exit closes listener and owned host without waiting for deadline', { timeout: 2000 }, async () => {
  const f = fixture();
  const window = await openWindow(f.options);
  f.reviewExit.resolve({ signal: 'SIGTERM' });
  await flush();
  assert.deepEqual(f.calls.slice(3), ['listener.close', 'review.close', 'host.close']);
  await window.stop();
  assert.equal(f.calls.filter(c => c === 'listener.close').length, 1);
});

test('host exit before ready rejects startup and never opens review or binds', { timeout: 2000 }, async () => {
  const f = fixture({ ready: false });
  const opening = openWindow(f.options);
  const rejected = assert.rejects(opening);
  f.hostExit.resolve({ code: 1 });
  await rejected;
  assert.deepEqual(f.calls, ['host.start', 'host.close']);
  assert.equal(f.scheduled.length, 0);
  f.hostReady.resolve(f.identity);
  await flush();
  assert.deepEqual(f.calls, ['host.start', 'host.close'], 'a late ready must not resurrect startup');
});

test('already-exited host cannot bind even when ready is already resolved', { timeout: 2000 }, async () => {
  const f = fixture();
  f.hostExit.resolve({ code: 1 });
  await assert.rejects(openWindow(f.options));
  assert.equal(f.calls.includes('bind'), false);
  assert.equal(f.scheduled.length, 0);
  assert.equal(f.calls.filter(c => c === 'host.close').length, 1);
});

test('host exit during pending bind closes late listener and never returns a live window', { timeout: 2000 }, async () => {
  const f = fixture({ pendingBind: true });
  const opening = openWindow(f.options);
  const outcome = opening.then(value => ({ value }), error => ({ error }));
  await flush();
  assert.equal(f.calls.filter(c => c === 'bind').length, 1);
  f.hostExit.resolve({ code: 1 });
  await flush();
  f.bindResult.resolve(f.listener);
  const settled = await outcome;
  assert.ok(settled.error, 'an exit during bind must reject startup');
  await flush();
  assert.equal(f.calls.filter(c => c === 'listener.close').length, 1, 'a listener resolving after cancellation must close');
  assert.equal(f.calls.filter(c => c === 'review.close').length, 1);
  assert.equal(f.calls.filter(c => c === 'host.close').length, 1);
  assert.equal(f.scheduled.length, 0, 'a cancelled bind must not arm a new live window');
});

test('host ready rejection preserves failure and cleans its owned startup without binding', { timeout: 2000 }, async () => {
  const f = fixture({ ready: false });
  const failure = new Error('HOST_READY_FAILED');
  const opening = openWindow(f.options);
  const rejected = assert.rejects(opening, error => error === failure);
  f.hostReady.reject(failure);
  await rejected;
  assert.deepEqual(f.calls, ['host.start', 'host.close']);
  assert.equal(f.scheduled.length, 0);
});

test('actual owned child exit triggers cleanup; network boundary remains an explicit fake', { timeout: 3000 }, async () => {
  const child = spawn(process.execPath, ['-e', 'process.send("ready"); setInterval(() => {}, 1000);'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const ready = new Promise(resolve => child.once('message', resolve));
  const closed = [];
  let window;
  try {
    window = await openWindow({
      startHost: () => ({ ready, exited, async stop() { closed.push('host'); if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await exited; } }),
      openReview: async () => ({ async close() { closed.push('review'); } }),
      bindWindow: async () => ({ async close() { closed.push('fake-listener'); } }),
    });
    child.kill('SIGTERM');
    const result = await exited; await flush(); await window.stop();
    assert.equal(result.signal, 'SIGTERM');
    assert.deepEqual(closed, ['fake-listener', 'review', 'host']);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited; await window?.stop();
  }
});
