// Owns startup and cleanup, not a network implementation. Tests supply explicit boundaries.
export async function openWindow({ startHost, openReview, bindWindow, timers = globalThis, log = () => {} }) {
  let peer, review, listener, timer, stopping, cancelled = false;
  async function stop() {
    if (stopping) return stopping;
    cancelled = true;
    stopping = (async () => {
      if (timer) timers.clearTimeout(timer);
      const errors = [];
      for (const [resource, close] of [[listener, 'close'], [review, 'close'], [peer, 'stop']]) {
        try { await resource?.[close](); } catch (error) { errors.push(error); log('cleanup-error', { message: error.message }); }
      }
      if (errors.length) throw new AggregateError(errors, 'WINDOW_CLEANUP_FAILED');
    })();
    return stopping;
  }
  const exit = () => { cancelled = true; void stop().catch(error => log('stop-error', { message: error.message })); };
  try {
    peer = startHost();
    const exited = peer.exited.then(() => { exit(); throw new Error('HOST_EXITED'); });
    // Keep a rejection handler after the readiness race has settled, too.
    exited.catch(() => {});
    const ready = await Promise.race([peer.ready, exited]);
    if (cancelled) throw new Error('HOST_EXITED');
    review = await openReview(peer, ready);
    if (cancelled) { await review.close(); throw new Error('HOST_EXITED'); }
    review.exited?.then(exit, exit);
    const bound = await bindWindow(review);
    if (cancelled) { await bound.close(); throw new Error('HOST_EXITED_DURING_BIND'); }
    listener = bound;
    listener.exited?.then(exit, exit);
    timer = timers.setTimeout(() => { void stop().catch(error => log('stop-error', { message: error.message })); }, 600000);
    return { stop };
  } catch (error) {
    await stop().catch(cleanupError => log('stop-error', { message: cleanupError.message }));
    throw error;
  }
}

// A real server in the launcher; an EventEmitter server in non-listening tests.
export async function listenPreview(server) {
  const sockets = new Set();
  let closing, resolveExit;
  const exited = new Promise(resolve => { resolveExit = resolve; });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  function close() {
    if (closing) return closing;
    closing = new Promise(resolve => {
      server.close(() => { resolveExit(); resolve(); });
      for (const socket of sockets) socket.destroy();
    });
    return closing;
  }
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(49793, '127.0.0.1', resolve);
    });
  } catch (error) { await close(); throw error; }
  server.on('error', () => { void close(); });
  return { close, exited };
}
