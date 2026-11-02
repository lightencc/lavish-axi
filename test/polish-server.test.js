import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { serve, RELOAD_DEBOUNCE_MS } from "../src/server.js";

// Real HTTP server and real isolated storage. Only the Pi adapter is a test double.
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "polish-server-"));
  let server, receiver;
  t.after(async () => {
    try {
      await server?.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  const artifact = path.join(dir, "artifact.html");
  await writeFile(artifact, '<!doctype html><html><body><p id="alpha">Alpha paragraph</p></body></html>');
  const deliveries = [];
  const polishHost = {
    instance: "owned-test-pi",
    session: "owned-test-session",
    setReceiver(fn) {
      receiver = fn;
    },
    async deliver(message, claim) {
      deliveries.push(structuredClone({ message, claim }));
      return { ...claim, kind: "queued", evidenceId: `queued-${claim.id}` };
    },
    async query() {
      return null;
    },
  };
  server = await serve({
    port: 0,
    hosts: ["127.0.0.1"],
    stateFile: path.join(dir, "state.json"),
    polishHost,
    idleTimeoutMs: null,
    detectTailscale: async () => null,
    env: {
      ...process.env,
      LAVISH_AXI_STATE_DIR: dir,
      LAVISH_AXI_HOST: "127.0.0.1",
      LAVISH_AXI_LINK_HOST: "127.0.0.1",
      LAVISH_AXI_TELEMETRY: "0",
    },
  });
  assert.ok(server.port > 0);
  assert.ok(server.addresses.every((address) => address.address === "127.0.0.1"));
  const base = `http://127.0.0.1:${server.port}`;
  const post = (route, payload, origin = base) =>
    fetch(base + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(origin === null ? {} : { Origin: origin }) },
      body: JSON.stringify(payload),
    });
  const opened = await post("/api/sessions", { file: artifact });
  assert.equal(opened.status, 200);
  const { key } = await opened.json();
  assert.ok(key);
  const review = async () => {
    const response = await fetch(`${base}/api/${key}/review`);
    assert.equal(response.status, 200, "the real review snapshot route must be available");
    return response.json();
  };
  return {
    base,
    artifact,
    key,
    polishHost,
    deliveries,
    post,
    review,
    async receive(proof) {
      assert.equal(typeof receiver, "function", "serve must register the trusted host receiver");
      await receiver(key, proof);
    },
  };
}

const sessionPrompt = (id) => ({
  prompt_id: id,
  scope: "session",
  round_id: randomUUID(),
  prompt: "Overall page feedback",
});
const consume = (claim) => ({
  ...claim,
  kind: "consumed",
  evidenceId: `input-${claim.id}`,
  inputEvidence: "context_with_system",
});
async function until(read, predicate, label) {
  const deadline = Date.now() + 1500;
  for (;;) {
    const value = await read();
    if (predicate(value)) return value;
    if (Date.now() >= deadline) assert.fail(`timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const findMessage = (snapshot, id) => snapshot.messages.find((message) => message.id === id);

test("real session creation binds the supplied host and exposes review version and artifact revision", async (t) => {
  const f = await fixture(t);
  const snapshot = await f.review();
  assert.equal(snapshot.binding.instance, f.polishHost.instance);
  assert.equal(snapshot.binding.session, f.polishHost.session);
  assert.equal(snapshot.binding.artifact, await realpath(f.artifact));
  assert.equal(snapshot.epoch, 1);
  assert.ok(Number.isSafeInteger(snapshot.version));
  assert.ok(Number.isSafeInteger(snapshot.artifact_revision));
  assert.deepEqual(snapshot.messages, []);
});

test("browser cannot set host session, instance or binding while opening a review", async (t) => {
  const f = await fixture(t);
  for (const forged of [
    { session: "other-session" },
    { instance: "other-host" },
    { binding: { artifact: f.artifact, instance: "other-host", session: "other-session" } },
  ]) {
    const response = await f.post("/api/sessions", { file: f.artifact, ...forged });
    assert.equal(response.status, 400, "browser-supplied host binding must be rejected, not adopted");
  }
  const snapshot = await f.review();
  assert.equal(snapshot.binding.instance, f.polishHost.instance);
  assert.equal(snapshot.binding.session, f.polishHost.session);
  assert.equal(f.deliveries.length, 0);
});

test("real prompt endpoint requires the current review epoch before accepting feedback", async (t) => {
  const f = await fixture(t);
  const missing = await f.post(`/api/${f.key}/prompts`, { prompts: [sessionPrompt("server-missing-epoch")] });
  assert.ok([400, 409].includes(missing.status), "missing review_epoch must not be accepted");
  const stale = await f.post(`/api/${f.key}/prompts`, {
    review_epoch: 999,
    prompts: [sessionPrompt("server-stale-epoch")],
  });
  assert.equal(stale.status, 409);
  assert.deepEqual((await f.review()).messages, []);
  assert.equal(f.deliveries.length, 0);
});

test("session send has no fabricated anchor; HTTP success and queued proof do not fake consumption", async (t) => {
  const f = await fixture(t);
  const p = { ...sessionPrompt("server-overall"), selector: "#alpha", tag: "p", text: "Alpha paragraph" };
  const sent = await f.post(`/api/${f.key}/prompts`, { review_epoch: 1, prompts: [p] });
  assert.equal(sent.status, 200);
  const initial = await f.review();
  assert.equal(findMessage(initial, p.prompt_id).consumed, false);
  const queued = await until(
    f.review,
    (s) => findMessage(s, p.prompt_id)?.state === "host_queued",
    "host queued receipt",
  );
  const m = findMessage(queued, p.prompt_id);
  assert.equal(m.consumed, false);
  assert.equal(m.prompt.scope, "session");
  for (const field of ["selector", "tag", "text"]) assert.equal(Object.hasOwn(m.prompt, field), false);
  assert.equal(f.deliveries.length, 1);
  const { claim } = f.deliveries[0];
  assert.equal(claim.instance, f.polishHost.instance);
  assert.equal(claim.session, f.polishHost.session);
  await f.receive(consume(claim));
  const delivered = await until(f.review, (s) => findMessage(s, p.prompt_id)?.consumed, "real input witness");
  assert.equal(findMessage(delivered, p.prompt_id).state, "delivered");
  await f.receive({
    ...consume(claim),
    kind: "reply",
    evidenceId: `reply-${claim.id}`,
    replyTo: claim.id,
    round_id: p.round_id,
    text: "The whole-page update is ready",
  });
  const replied = await until(f.review, (s) => findMessage(s, p.prompt_id)?.state === "replied", "exact reply");
  assert.equal(findMessage(replied, p.prompt_id).reply.text, "The whole-page update is ready");
  assert.equal(findMessage(replied, p.prompt_id).resolved, false);
  assert.equal(f.deliveries.length, 1, "receipt and reply must not trigger duplicate host delivery");
});

test("prompt, complete and end mutations reject foreign and absent Origin without changing review", async (t) => {
  const f = await fixture(t);
  const mutations = [
    [`/api/${f.key}/prompts`, { review_epoch: 1, prompts: [sessionPrompt("server-forbidden")] }],
    [
      `/api/${f.key}/review/complete`,
      { epoch: 1, comment_id: "unknown", round_id: randomUUID(), reply_version: 1, artifact_revision: 0 },
    ],
    [`/api/${f.key}/review/end`, { id: "server-forbidden-end", epoch: 1, final: null }],
  ];
  for (const [route, payload] of mutations) {
    for (const origin of ["https://foreign.example", null]) {
      const response = await f.post(route, payload, origin);
      assert.equal(response.status, 403, `${route} must require same-origin mutation`);
    }
  }
  const snapshot = await f.review();
  assert.equal(snapshot.lifecycle, "open");
  assert.deepEqual(snapshot.messages, []);
  assert.equal(f.deliveries.length, 0);
});

test("API end stays ending while queued, then ends only after existing input and marker consumption", async (t) => {
  const f = await fixture(t);
  const p = sessionPrompt("server-before-end");
  assert.equal((await f.post(`/api/${f.key}/prompts`, { review_epoch: 1, prompts: [p] })).status, 200);
  await until(f.review, (s) => findMessage(s, p.prompt_id)?.state === "host_queued", "existing feedback queued");
  const endId = "server-review-end",
    markerId = `${endId}-marker`;
  const response = await f.post(`/api/${f.key}/review/end`, { id: endId, epoch: 1, final: null });
  assert.equal(response.status, 200);
  const ending = await f.review();
  assert.equal(ending.lifecycle, "ending");
  assert.deepEqual(ending.end.ids, [p.prompt_id, markerId]);
  assert.equal(findMessage(ending, p.prompt_id).consumed, false);
  assert.equal(findMessage(ending, markerId).consumed, false);
  await f.receive(consume(f.deliveries[0].claim));
  const markerQueued = await until(
    f.review,
    (s) => findMessage(s, markerId)?.state === "host_queued",
    "end marker queued after preceding input",
  );
  assert.equal(markerQueued.lifecycle, "ending");
  assert.equal(findMessage(markerQueued, markerId).consumed, false);
  assert.deepEqual(
    f.deliveries.map(({ claim }) => claim.id),
    [p.prompt_id, markerId],
  );
  await f.receive(consume(f.deliveries[1].claim));
  const ended = await until(f.review, (s) => s.lifecycle === "ended", "end marker consumed");
  assert.ok(ended.messages.every((m) => m.consumed));
  assert.equal(findMessage(ended, markerId).state, "delivered");
  assert.equal(findMessage(ended, markerId).reply, undefined, "ending must not wait for a model answer");
});

test("a submission losing the end seal is a definitive conflict, never an uncertain server failure", async (t) => {
  const f = await fixture(t);
  await f.post(`/api/${f.key}/review/end`, { id: "seal-wins", epoch: 1, final: null });
  const sealed = await f.review();
  assert.equal(sealed.lifecycle, "ending");
  const result = await f.post(`/api/${f.key}/prompts`, {
    review_epoch: 1,
    prompts: [sessionPrompt("late-after-seal")],
  });
  assert.equal(result.status, 409);
  assert.equal((await result.json()).error, "CLOSED");
  const after = await f.review();
  assert.deepEqual(after.end.ids, sealed.end.ids);
  assert.ok(!after.messages.some((m) => m.id === "late-after-seal"));
  await until(f.review, (s) => findMessage(s, "seal-wins-marker")?.state === "host_queued", "sealed marker queued");
});

test("ended review stops artifact reload events after its final marker is consumed", async (t) => {
  const f = await fixture(t);
  const page = await fetch(`${f.base}/session/${f.key}`);
  assert.equal(page.status, 200);
  await page.text();
  const socket = new WebSocket(`${f.base.replace(/^http/, "ws")}/events/${f.key}`, { origin: f.base });
  const messages = [];
  socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
  try {
    await once(socket, "open");
    // Allow initial watcher registration, then prove the exact connection receives file reloads.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await writeFile(f.artifact, "<!doctype html><html><body>Before ending</body></html>");
    await until(
      async () => messages,
      (items) => items.some((event) => event.type === "reload"),
      "live artifact watcher before end",
    );
    const id = "server-watcher-end";
    const response = await f.post(`/api/${f.key}/review/end`, { id, epoch: 1, final: null });
    assert.equal(response.status, 200);
    await until(
      f.review,
      (snapshot) => findMessage(snapshot, `${id}-marker`)?.state === "host_queued",
      "end marker queued",
    );
    const marker = f.deliveries.find(({ claim }) => claim.id === `${id}-marker`);
    assert.ok(marker);
    await f.receive(consume(marker.claim));
    await until(f.review, (snapshot) => snapshot.lifecycle === "ended", "review ended from marker receipt");
    await until(
      async () => messages,
      (items) => items.some((event) => event.type === "ended"),
      "end transition on the real socket",
    );
    messages.length = 0;
    await writeFile(f.artifact, "<!doctype html><html><body>Changed after ending</body></html>");
    // Exceed chokidar's 100ms stability check plus the normal save debounce.
    await new Promise((resolve) => setTimeout(resolve, RELOAD_DEBOUNCE_MS + 500));
    assert.deepEqual(
      messages.filter((event) => event.type === "reload"),
      [],
      "ended communication must not keep broadcasting artifact file changes",
    );
  } finally {
    socket.terminate();
  }
});
