import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { createClaudeChannel } from "../src/claude-channel.js";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "polish-channel-"));
  await mkdir(path.join(directory, "artifacts"));
  const file = path.join(directory, "artifacts", "fictional.html");
  await writeFile(file, '<!doctype html><p id="test">Fictional garden</p>');
  const channel = createClaudeChannel({ stateRoot: path.join(directory, "state") });
  const client = new Client({ name: "synthetic-mcp-consumer", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const events = [];
  client.setNotificationHandler(
    z.object({ method: z.literal("notifications/claude/channel"), params: z.any() }),
    (event) => {
      events.push(event.params);
    },
  );
  await channel.connect(a);
  await client.connect(b);
  t.after(async () => {
    await client.close();
    await channel.close();
    await rm(directory, { recursive: true, force: true });
  });
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    const text = /** @type {Array<{type: string, text?: string}>} */ (result.content).find(
      (item) => item.type === "text",
    ).text;
    if (result.isError) throw new Error(text);
    return JSON.parse(text);
  };
  const session_id = "fictional-current-claude";
  return { channel, client, directory, file, events, call, session_id };
}
const waitFor = async (read) => {
  for (let i = 0; i < 150; i++) {
    const value = await read();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail("Timed out waiting for isolated protocol test");
};
const token = (event) => ({ ...JSON.parse(event.meta.identity), receipt: event.meta.receipt });

test("MCP capability and channel challenge gate prevent silently dropping browser input", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(f.client.getServerCapabilities().experimental["claude/channel"], {});
  await assert.rejects(
    f.call("open_review", { session_id: f.session_id, file: f.file, open_browser: false }),
    /CHANNEL_NOT_CONFIRMED/,
  );
  await f.call("bind_session", { session_id: f.session_id });
  const probe = await waitFor(() => f.events.find((event) => event.meta.event === "polish_channel_probe"));
  await assert.rejects(f.call("confirm_channel", { challenge: "bad" }), /CHANNEL_CHALLENGE/);
  await f.call("confirm_channel", { challenge: probe.meta.challenge });
  const unsafeFile = path.join(f.directory, "unsafe.html");
  await writeFile(unsafeFile, "<!doctype html><p>Fictional unsafe state co-location</p>");
  await assert.rejects(
    f.call("open_review", { session_id: f.session_id, file: unsafeFile, open_browser: false }),
    /PRIVATE_STATE/,
  );
  await assert.rejects(f.call("bind_session", { session_id: "other-session" }), /SESSION_MISMATCH/);
  const opened = await f.call("open_review", { session_id: f.session_id, file: f.file, open_browser: false });
  assert.match(opened.url, /^http:\/\/127\.0\.0\.1:/);
  assert.equal(opened.binding.session, f.session_id);
});

test("real HTTP/store plus MCP consume/reply reaches page and safely drains ending", async (t) => {
  const f = await fixture(t);
  await f.call("bind_session", { session_id: f.session_id });
  const probe = await waitFor(() => f.events[0]);
  await f.call("confirm_channel", { challenge: probe.meta.challenge });
  const opened = await f.call("open_review", { session_id: f.session_id, file: f.file, open_browser: false });
  const base = new URL(opened.url).origin,
    key = opened.key;
  const post = (route, body, origin = base) =>
    fetch(base + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body),
    });
  const read = async () => (await fetch(`${base}/api/${key}/review`)).json();
  const unsafeFile = path.join(f.directory, "unsafe.html");
  await writeFile(unsafeFile, "<!doctype html><p>Private-root ancestor</p>");
  assert.equal(
    (await post("/api/sessions", { file: unsafeFile })).status,
    403,
    "HTTP open must enforce the same private-state boundary as MCP open",
  );
  const body = {
    review_epoch: 1,
    prompts: [
      { prompt_id: "cloud-fictional-one", scope: "session", round_id: "one", prompt: "Please review fictional text" },
    ],
  };
  assert.equal((await post(`/api/${key}/prompts`, body, "https://foreign.example")).status, 403);
  assert.equal((await post(`/api/${key}/prompts`, body)).status, 200);
  assert.equal((await post(`/api/${key}/prompts`, body)).status, 200);
  const event = await waitFor(() => f.events.find((e) => e.meta.event === "polish_feedback"));
  const state = await read();
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].consumed, false);
  assert.ok(!JSON.stringify(state).includes(event.meta.receipt));
  assert.equal((await post(`/api/${key}/review/consume`, token(event))).status, 404);
  await f.call("consume_feedback", token(event));
  assert.equal((await read()).messages[0].consumed, true);
  await post(`/api/${key}/review/end`, {
    id: "fictional-end",
    epoch: 1,
    final: { id: "last", epoch: 1, text: "Last fictional note" },
  });
  assert.equal((await read()).lifecycle, "ending");
  const last = await waitFor(() => f.events.find((e) => e.meta.identity && JSON.parse(e.meta.identity).id === "last"));
  await f.call("consume_feedback", token(last));
  const end = await waitFor(() => f.events.find((e) => e.meta.kind === "end"));
  assert.equal((await read()).lifecycle, "ending");
  await f.call("consume_feedback", token(end));
  assert.equal((await read()).lifecycle, "ended");
  await f.call("reply_feedback", { ...token(event), text: "The fictional revision is complete." });
  assert.equal((await read()).messages[0].reply.text, "The fictional revision is complete.");
  assert.equal((await read()).lifecycle, "ended", "late reply cannot reopen the review");
  assert.equal(
    (await post(`/api/${key}/prompts`, { review_epoch: 1, prompts: [{ prompt_id: "late", prompt: "late" }] })).status,
    409,
  );
  await f.channel.close();
  await assert.rejects(fetch(base + "/health"));
});
