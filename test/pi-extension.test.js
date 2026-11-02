import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import polishExtension from "../src/pi-extension.js";

test("same Pi session restarts its owned endpoint so an existing browser URL can reconnect", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "polish-extension-"));
  const transcript = path.join(root, "pi-session.jsonl");
  const previous = process.env.POLISH_PI_STATE_ROOT;
  process.env.POLISH_PI_STATE_ROOT = root;
  const handlers = new Map();
  const pi = {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return () => handlers.get(event).delete(handler);
    },
    registerCommand() {},
    sendMessage() {
      assert.fail("no messages were submitted");
    },
  };
  const ctx = {
    sessionManager: {
      getSessionId: () => "stable-endpoint-test",
      getSessionFile: () => transcript,
      getBranch: () => [],
    },
    isIdle: () => true,
    hasPendingMessages: () => false,
    ui: { notify() {} },
  };
  const emit = async (name) => {
    for (const handler of [...(handlers.get(name) || [])]) await handler({}, ctx);
  };
  t.after(async () => {
    await emit("session_shutdown");
    if (previous === undefined) delete process.env.POLISH_PI_STATE_ROOT;
    else process.env.POLISH_PI_STATE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  });
  polishExtension(pi);
  await emit("session_start");
  const endpoint = process.env.POLISH_PI_ENDPOINT;
  assert.equal((await fetch(endpoint + "/health")).status, 200);
  const artifact = path.join(root, "artifact.html");
  await writeFile(artifact, "<!doctype html><p>Session durability</p>");
  const openArtifact = () =>
    fetch(endpoint + "/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: artifact }),
    });
  const refused = await openArtifact();
  assert.equal(refused.status, 409, "an in-memory Pi identity must not accept durable review feedback");
  assert.match((await refused.json()).error, /PI_SESSION_NOT_DURABLE/);
  await writeFile(transcript, JSON.stringify({ type: "session", id: "different-session" }) + "\n");
  assert.equal((await openArtifact()).status, 409, "another transcript must not authorize this binding");
  await writeFile(transcript, JSON.stringify({ type: "session", id: "stable-endpoint-test" }) + "\n");
  assert.equal((await openArtifact()).status, 200);
  await emit("session_shutdown");
  await emit("session_start");
  assert.equal(process.env.POLISH_PI_ENDPOINT, endpoint);
  assert.equal((await fetch(endpoint + "/health")).status, 200);
});
