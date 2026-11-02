import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve, restoreClaimedFeedback } from "../src/server.js";
import { createPolishSkillMarkdown } from "../src/skill.js";
import { SessionStore, sessionKey, canonicalFile } from "../src/session-store.js";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { once } from "node:events";

test("Polish skill reuses Lavish request generation and keeps an existing HTML branch", () => {
  const skill = createPolishSkillMarkdown();
  assert.match(skill, /\$ARGUMENTS/);
  assert.match(skill, /infer.*conversation/);
  assert.match(skill, /build.*HTML/);
  assert.match(skill, /existing HTML.*without regenerating/);
  assert.doesNotMatch(skill, /Channels|MCP|polish-claude/);
});

test("ordinary Lavish server supports Polish page, repeated poll/reply, completion and final end", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "polish-lavish-flow-"));
  const file = path.join(dir, "fixture.html"),
    html = '<!doctype html><p id="a">Fictional page</p><form><input name="answer"></form>';
  await writeFile(file, html);
  const server = await serve({
    version: "0.1.96",
    port: 0,
    hosts: ["127.0.0.1"],
    stateFile: path.join(dir, "state.json"),
    idleTimeoutMs: null,
    detectTailscale: async () => null,
  });
  t.after(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.port}`;
  const cli = async (args) => {
    const result = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL("../dist/polish", import.meta.url)), ...args],
      {
        timeout: 10000,
        env: {
          ...process.env,
          POLISH_ENDPOINT: "",
          POLISH_PI_ENDPOINT: "",
          LAVISH_AXI_STATE_DIR: dir,
          LAVISH_AXI_PORT: String(server.port),
          LAVISH_AXI_HOST: "127.0.0.1",
          LAVISH_AXI_TELEMETRY: "0",
          LAVISH_AXI_NO_OPEN: "1",
        },
      },
    );
    return result.stdout;
  };
  const post = async (route, body) => {
    const response = await fetch(base + route, {
      method: "POST",
      headers: { "content-type": "application/json", Origin: base },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const key = sessionKey(await canonicalFile(file));
  const opened = await cli(["--no-open", file]);
  const socket = new WebSocket(`${base.replace(/^http/, "ws")}/events/${key}`, { origin: base });
  t.after(() => socket.close());
  await once(socket, "open");
  assert.ok(opened.includes(file));
  assert.equal(await readFile(file, "utf8"), html, "opening existing HTML never regenerates it");
  const page = await (await fetch(`${base}/session/${key}`)).text();
  assert.match(page, /polish-client.js/);
  const read = async () => (await fetch(`${base}/api/${key}/review`)).json();
  const poll = async () => (await fetch(`${base}/api/poll?file=${encodeURIComponent(file)}&timeoutMs=50`)).json();
  for (const id of ["one", "two"]) {
    await post(`/api/${key}/prompts`, {
      review_epoch: 1,
      prompts: [
        {
          prompt_id: id,
          prompt: `Change ${id}`,
          scope: id === "two" ? "anchored" : "session",
          round_id: id,
          ...(id === "two" ? { comment_id: "comment-two", selector: "#a", text: "Fictional page" } : {}),
        },
      ],
    });
    if (id === "one") assert.match(await cli(["poll", file, "--timeout-ms", "50"]), /Change one/);
    else {
      const delivered = await poll();
      assert.equal(delivered.status, "feedback");
      assert.equal(delivered.prompts[0].prompt_id, id);
    }
    assert.equal((await read()).messages.find((m) => m.id === id).consumed, true);
    if (id === "one") await cli(["reply", file, "--agent-reply", `Done ${id}`]);
    else await post(`/api/${key}/agent-reply`, { text: `Done ${id}` });
    assert.equal((await read()).messages.find((m) => m.id === id).reply.text, `Done ${id}`);
  }
  const store = new SessionStore(path.join(dir, "state.json"));
  const handoff = await store.issueReviewerHandoff(key);
  const load = await store.beginArtifactLoad(key, {
    requestId: randomUUID(),
    requestSequence: handoff.artifact_load_sequence + 1,
    handoffToken: handoff.chrome_load_token,
  });
  const artifact = await (
    await fetch(
      `${base}/artifact/${key}/index.html?artifact_load_token=${load.artifact_load_token}&artifact_revision=${load.artifact_revision}`,
    )
  ).text();
  assert.match(artifact, /<form><input name="answer"><\/form>/, "native form remains intact");
  const state = await read();
  await post(`/api/${key}/review/complete`, {
    epoch: 1,
    comment_id: "comment-two",
    round_id: "two",
    reply_version: 1,
    artifact_revision: state.artifact_revision,
    artifact_load_token: state.artifact_load_token,
    artifact_digest: state.artifact_digest,
  });
  assert.equal((await read()).messages.find((m) => m.id === "two").resolved, true);
  const pendingPoll = fetch(`${base}/api/poll?file=${encodeURIComponent(file)}&timeoutMs=1000`).then((r) => r.json());
  await new Promise((resolve) => setTimeout(resolve, 30));
  const endingAt = Date.now();
  await post(`/api/${key}/review/end`, {
    id: "finish",
    epoch: 1,
    final: { id: "final", epoch: 1, text: "Final note" },
  });
  assert.equal((await pendingPoll).prompts?.[0]?.prompt_id, "final", "end wakes the poll already waiting");
  assert.ok(Date.now() - endingAt < 700, "ending must wake poll before its 1000ms test timeout");
  const ended = await poll();
  assert.equal(ended.session_ended, true);
  assert.equal((await read()).lifecycle, "ended");
  assert.equal((await poll()).status, "ended");
  assert.equal((await post("/api/sessions", { file, polish: true })).status, "user-ended");
  await post("/api/sessions", { file, polish: true, reopen: true });
  await post(`/api/${key}/prompts`, {
    review_epoch: 2,
    prompts: [{ prompt_id: "before-cli-end", prompt: "Queued before end" }],
  });
  await cli(["end", file]);
  assert.equal((await poll()).prompts?.[0]?.prompt_id, "before-cli-end", "CLI end preserves previously queued input");
  assert.match(await cli([file, "--no-open"]), /opened/);
});

test("known pre-response disconnect restores poll feedback without changing bridge unknown semantics", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "polish-poll-restore-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "page.html");
  await writeFile(file, "<!doctype html><p>Fixture</p>");
  const store = new SessionStore(path.join(dir, "state.json"));
  const { key, file: canonical } = await store.upsertSession(file, "http://127.0.0.1");
  await store.bindFeedback(key, {
    artifact: canonical,
    instance: "fixture",
    session: "lavish-poll",
    inputEvidence: "poll_response",
  });
  await store.queuePrompts(key, { review_epoch: 1, prompts: [{ prompt_id: "restore", prompt: "Keep this feedback" }] });
  const lease = await store.feedbackLease(key, "poll");
  const first = await store.takeFeedback(key, lease);
  await restoreClaimedFeedback(store, key, first);
  const again = await store.takeFeedback(key, lease);
  assert.equal(again.status, "feedback");
  assert.equal(again.prompts[0].prompt_id, "restore");
});
