import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import WebSocket from "ws";
import { serve } from "../src/server.js";
import { SessionStore } from "../src/session-store.js";

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise((done) => {
    resolve = () => done(undefined);
  });
  return { promise, resolve };
};

// Real HTTP, WebSocket and durable store. The host is a controlled substitute, not Pi evidence.
test(
  "A22: registration/snapshot race sends the initial snapshot before buffered newer review states",
  { timeout: 5000 },
  async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), "polish-sync-"));
    const captured = deferred(),
      release = deferred(),
      queued = deferred();
    let server, socket;
    t.after(async () => {
      release.resolve();
      socket?.terminate();
      await server?.close();
      await rm(dir, { recursive: true, force: true });
    });
    const artifact = path.join(dir, "artifact.html");
    await writeFile(artifact, "<!doctype html><p>Sync fixture</p>");
    server = await serve({
      port: 0,
      hosts: ["127.0.0.1"],
      stateFile: path.join(dir, "state.json"),
      idleTimeoutMs: null,
      detectTailscale: async () => null,
      env: {
        ...process.env,
        LAVISH_AXI_STATE_DIR: dir,
        LAVISH_AXI_HOST: "127.0.0.1",
        LAVISH_AXI_LINK_HOST: "127.0.0.1",
        LAVISH_AXI_TELEMETRY: "0",
      },
      polishHost: {
        instance: "sync-fixture-host",
        session: "sync-fixture-session",
        setReceiver() {},
        query: async () => null,
        deliver: async (_message, claim) => {
          queued.resolve();
          return { ...claim, kind: "queued", evidenceId: "queued-fixture" };
        },
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    const post = (route, body) =>
      fetch(base + route, {
        method: "POST",
        headers: { Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const opened = await post("/api/sessions", { file: artifact });
    const { key } = await opened.json();
    const original = SessionStore.prototype.findByKey;
    let intercepted = false;
    t.mock.method(SessionStore.prototype, "findByKey", async function (...args) {
      const initial = new Error().stack.includes("sendInitialLiveEventState");
      const value = await original.apply(this, args);
      if (initial && !intercepted && new Error().stack.includes("snapshot")) {
        intercepted = true;
        captured.resolve();
        await release.promise;
      }
      return value;
    });
    const frames = [];
    socket = new WebSocket(`${base.replace("http:", "ws:")}/events/${key}`, { origin: base });
    socket.on("message", (data) => frames.push(JSON.parse(data.toString())));
    await Promise.race([
      captured.promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("initial snapshot barrier not reached")), 2000).unref(),
      ),
    ]);
    assert.equal(
      (
        await post(`/api/${key}/prompts`, {
          review_epoch: 1,
          prompts: [
            { prompt_id: "sync-race-message", prompt: "Revise page", scope: "session", round_id: "sync-race-round" },
          ],
        })
      ).status,
      200,
    );
    await queued.promise;
    release.resolve();
    // Wait for the wire to include initial presence and the persisted queued receipt.
    for (let i = 0; i < 100; i++) {
      if (
        frames.some((f) => f.type === "agent-presence") &&
        frames.some((f) => f.type === "polish-review" && f.data.messages.some((m) => m.state === "host_queued"))
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const reviews = frames.filter((f) => f.type === "polish-review").map((f) => f.data);
    assert.ok(reviews.length >= 2, "must observe both the held initial snapshot and the newer submission");
    assert.deepEqual(
      reviews.map((s) => s.version),
      reviews.map((s) => s.version).sort((a, b) => a - b),
      "held initial snapshot must never follow a newer review state",
    );
    assert.equal(reviews[0].full_snapshot, true);
    assert.ok(reviews[0].sync_id, "the initial snapshot identifies this synchronization connection");
    for (let i = 1; i < reviews.length; i++) {
      assert.equal(reviews[i].sync_id, reviews[0].sync_id);
      assert.equal(reviews[i].full_snapshot, false);
      assert.equal(
        reviews[i].previous_version,
        reviews[i - 1].version,
        "the visible chain explains internal mutation version jumps",
      );
    }
  },
);

async function transportFixture({ bound = true, asyncClose = false, nativeGate = false, initialEnded = false } = {}) {
  const source = await readFile(new URL("../src/chrome-client.js", import.meta.url), "utf8");
  const start = source.indexOf("const events = new Map();");
  const end = source.indexOf("// Raise the existing banner", start);
  assert.ok(start > 0 && end > start);
  const sockets = [],
    timers = [],
    applied = [];
  let disconnects = 0,
    ended = 0;
  class FakeSocket {
    constructor() {
      this.listeners = new Map();
      this.closed = false;
      sockets.push(this);
    }
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
    emit(type, data) {
      this.listeners.get(type)?.(data);
    }
    close() {
      this.closed = true;
      if (!asyncClose) this.emit("close");
    }
  }
  const controls = {
    frame: { inert: initialEnded },
    endedOverlay: { hidden: !initialEnded },
    moreButton: { disabled: initialEnded },
    annotationSwitch: { disabled: initialEnded, setAttribute() {} },
    chatInput: { disabled: initialEnded },
    sendButton: { disabled: initialEnded },
    sendAndEndButton: { disabled: initialEnded },
    chatAttachButton: { disabled: initialEnded },
    endButton: { disabled: initialEnded },
  };
  const frameMessages = [];
  const context = vm.createContext({
    ...controls,
    WebSocket: FakeSocket,
    location: { protocol: "http:", host: "isolated.invalid" },
    key: "fixture",
    setTimeout: (fn) => {
      timers.push(fn);
    },
    clearTimeout() {},
    liveEventFailures: 0,
    unreachableDismissed: false,
    unreachableBannerOwned: false,
    setChromeOutdated() {},
    refreshLayoutWarnings() {},
    noteLiveEventsUnreachable() {},
    ended: initialEnded,
    terminalSubmission: null,
    feedbackPreparations: new Set(),
    annotation: true,
    warningsQueueButton: null,
    updateSendState() {},
    applySheetState() {},
    render() {},
    renderWarnings() {},
    renderRevisionLegend() {},
    postToFrame(message) {
      frameMessages.push(message);
    },
    markSessionEnded() {
      ended++;
      context.ended = true;
    },
    polishReviewUi: bound
      ? {
          disconnected() {
            disconnects++;
          },
          sync(data) {
            applied.push(data);
          },
        }
      : null,
  });
  const endedStart = source.indexOf('events.set("ended",');
  const endedEnd = source.indexOf('events.set("polish-review",', endedStart);
  assert.ok(endedStart > end && endedEnd > endedStart);
  const reviewHandlerEnd = source.indexOf("if (sessionData.polish", endedEnd);
  const preparationStart = source.indexOf("function beginFeedbackPreparation()");
  const preparationEnd = source.indexOf("function enqueuePrompt(", preparationStart);
  const sendStateStart = source.indexOf("function updateSendState()");
  const sendStateEnd = source.indexOf("function attachmentCount(", sendStateStart);
  const handler = nativeGate
    ? source.slice(endedEnd, reviewHandlerEnd) +
      source.slice(preparationStart, preparationEnd) +
      source.slice(sendStateStart, sendStateEnd)
    : '\nevents.set("polish-review", data => polishReviewUi.sync(data));';
  vm.runInContext(
    source.slice(start, end) + source.slice(endedStart, endedEnd) + handler + "connectLiveEvents();",
    context,
  );
  return {
    sockets,
    timers,
    applied,
    controls,
    frameMessages,
    disconnects: () => disconnects,
    ended: () => ended,
    prepare: () => vm.runInContext("beginFeedbackPreparation()", context),
    send(socket, data) {
      socket.emit("message", { data: JSON.stringify({ type: "polish-review", data }) });
    },
    reconnect() {
      assert.equal(timers.length, 1, "exactly one reconnect must be pending");
      timers.shift()();
      return sockets.at(-1);
    },
  };
}

const snapshot = (version, overrides = {}) => ({
  epoch: 1,
  version,
  sync_id: "sync-one",
  full_snapshot: true,
  lifecycle: "open",
  messages: [],
  ...overrides,
});
const update = (version, previous_version, overrides = {}) =>
  snapshot(version, { full_snapshot: false, previous_version, ...overrides });

test("A22: an old WebSocket cannot apply review events after a replacement connection exists", async () => {
  const f = await transportFixture(),
    old = f.sockets[0];
  f.send(old, snapshot(10));
  old.close();
  const current = f.reconnect();
  f.send(current, snapshot(20, { epoch: 2, sync_id: "sync-two" }));
  f.send(old, update(99, 10));
  assert.deepEqual(
    f.applied.map((s) => s.epoch),
    [1, 2],
    "old connection messages must be ignored even with a larger version",
  );
});

test("A22: a late close from an obsolete WebSocket cannot disconnect or reconnect the current stream", async () => {
  const f = await transportFixture(),
    old = f.sockets[0];
  old.close();
  f.reconnect();
  const before = f.disconnects();
  old.emit("close");
  assert.equal(f.disconnects(), before);
  assert.equal(f.timers.length, 0, "obsolete close must not create a competing connection");
});

test("A22: visible previous_version permits internal version jumps while duplicate and older events never roll back", async () => {
  const f = await transportFixture(),
    socket = f.sockets[0];
  f.send(socket, snapshot(10));
  f.send(socket, update(14, 10));
  f.send(socket, update(14, 10));
  f.send(socket, update(12, 10));
  f.send(socket, snapshot(9));
  f.send(socket, update(18, 14));
  assert.deepEqual(
    f.applied.map((s) => s.version),
    [10, 14, 18],
  );
  assert.equal(socket.closed, false);
  assert.equal(f.timers.length, 0);
});

test("A22: a broken visible version chain retains known state and reconnects for an authoritative snapshot", async () => {
  const f = await transportFixture(),
    old = f.sockets[0];
  f.send(old, snapshot(10));
  f.send(old, update(17, 16));
  assert.deepEqual(
    f.applied.map((s) => s.version),
    [10],
    "a gap cannot apply an unverified live state",
  );
  assert.equal(old.closed, true);
  const current = f.reconnect();
  f.send(current, snapshot(17, { sync_id: "sync-two" }));
  f.send(old, update(16, 10));
  assert.deepEqual(
    f.applied.map((s) => s.version),
    [10, 17],
  );
});

test("A22: a different sync_id cannot splice an event into the current connection", async () => {
  const f = await transportFixture(),
    old = f.sockets[0];
  f.send(old, snapshot(10));
  f.send(old, update(14, 10, { sync_id: "alien-sync" }));
  assert.deepEqual(
    f.applied.map((s) => s.version),
    [10],
  );
  assert.equal(old.closed, true);
  assert.equal(f.timers.length, 1);
});

for (const full_snapshot of [false, true]) {
  test(`A22: epoch changes on an existing connection (${full_snapshot ? "snapshot" : "update"}) require a new authoritative connection`, async () => {
    const f = await transportFixture(),
      old = f.sockets[0];
    f.send(old, snapshot(10));
    f.send(old, update(20, 10, { epoch: 2, full_snapshot }));
    assert.deepEqual(
      f.applied.map((s) => s.epoch),
      [1],
      "an existing stream cannot authorize an epoch switch",
    );
    assert.equal(old.closed, true);
    const current = f.reconnect();
    f.send(current, snapshot(20, { epoch: 2, sync_id: "sync-two" }));
    assert.deepEqual(
      f.applied.map((s) => s.epoch),
      [1, 2],
    );
  });
}

test("A22: unversioned ended from an earlier epoch cannot terminate a bound review on a new authoritative connection", async () => {
  const f = await transportFixture(),
    old = f.sockets[0];
  f.send(old, snapshot(10));
  old.close();
  const current = f.reconnect();
  f.send(current, snapshot(20, { epoch: 2, sync_id: "sync-two" }));
  current.emit("message", { data: JSON.stringify({ type: "ended", data: { ended_by: "user" } }) });
  assert.equal(f.ended(), 0, "bound review lifecycle is controlled only by versioned review state");
  assert.equal(f.applied.at(-1).epoch, 2);
  assert.equal(f.applied.at(-1).lifecycle, "open");
  f.send(current, update(23, 20, { epoch: 2, sync_id: "sync-two", lifecycle: "ended" }));
  assert.equal(
    f.applied.at(-1).lifecycle,
    "ended",
    "a versioned current-epoch terminal state still reaches the bound UI",
  );
});

test("legacy unbound reviews still handle their original ended event", async () => {
  const f = await transportFixture({ bound: false });
  f.sockets[0].emit("message", { data: JSON.stringify({ type: "ended", data: { ended_by: "user" } }) });
  assert.equal(f.ended(), 1);
});

test("A22: a rejected stream ignores queued frames during the asynchronous WebSocket closing handshake", async () => {
  const f = await transportFixture({ asyncClose: true }),
    old = f.sockets[0];
  f.send(old, snapshot(10));
  f.send(old, update(17, 16));
  assert.equal(old.closed, true);
  assert.equal(f.timers.length, 0, "the browser close event has not arrived yet");
  f.send(old, update(14, 10));
  assert.deepEqual(
    f.applied.map((state) => state.version),
    [10],
    "calling close must invalidate the stream immediately, before the close event",
  );
  old.emit("close");
  const current = f.reconnect();
  f.send(current, snapshot(17, { sync_id: "replacement" }));
  assert.deepEqual(
    f.applied.map((state) => state.version),
    [10, 17],
  );
});

test("A27/A08: a new authoritative epoch reopens the native form gate after an initially ended page", async () => {
  const f = await transportFixture({ nativeGate: true, initialEnded: true }),
    old = f.sockets[0];
  f.send(old, snapshot(10, { lifecycle: "ended" }));
  assert.equal(f.prepare(), null, "the initial ended epoch must keep native form submission blocked");
  old.close();
  const current = f.reconnect();
  f.send(current, snapshot(20, { epoch: 2, sync_id: "reopened-epoch", lifecycle: "open" }));
  assert.equal(f.applied.at(-1).epoch, 2);
  assert.equal(f.applied.at(-1).lifecycle, "open", "the real handler must reach UI.sync without a swallowed exception");
  assert.equal(f.controls.endedOverlay.hidden, true);
  assert.equal(f.controls.frame.inert, false, "native artifact controls must be interactive again");
  for (const name of [
    "moreButton",
    "annotationSwitch",
    "chatInput",
    "sendButton",
    "sendAndEndButton",
    "chatAttachButton",
    "endButton",
  ]) {
    assert.equal(f.controls[name].disabled, false, `${name} must leave its old ended state`);
  }
  assert.equal(f.frameMessages.at(-1).type, "lavish:setAnnotationMode");
  assert.equal(f.frameMessages.at(-1).enabled, true);
  const preparation = f.prepare();
  assert.ok(
    preparation,
    "the native form preparation gate must follow the trusted reopened epoch, not the previous ended flag",
  );
  preparation.finish(true);
});
