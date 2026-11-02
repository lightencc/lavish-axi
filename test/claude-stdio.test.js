import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { claudeLaunchArgs } from "../src/claude-launch.js";

test("launcher uses scoped MCP JSON and /polish skill without installing or bypassing permissions", () => {
  const args = claudeLaunchArgs(["--resume", "intended-session"]);
  const config = JSON.parse(args[args.indexOf("--mcp-config") + 1]);
  assert.equal(config.mcpServers.polish.command, process.execPath);
  assert.ok(path.isAbsolute(config.mcpServers.polish.args[0]));
  assert.ok(args.includes("server:polish"));
  assert.ok(args.includes("--strict-mcp-config"));
  assert.equal(args[args.indexOf("--permission-mode") + 1], "default");
  assert.deepEqual(args.slice(-2), ["--resume", "intended-session"]);
  for (const mode of ["-p", "--print", "--print=hello", "--bg", "--background", "--dangerously-skip-permissions"])
    assert.throws(() => claudeLaunchArgs([mode]), /interactive/);
});

test("launcher normalizes safe equivalents and rejects permission/configuration overrides", () => {
  const compatible = claudeLaunchArgs(["--resume=session-a", "--model", "sonnet", "-n", "review", "--verbose"]);
  assert.deepEqual(compatible.slice(-7), [
    "--resume",
    "session-a",
    "--model",
    "sonnet",
    "--name",
    "review",
    "--verbose",
  ]);
  assert.throws(() => claudeLaunchArgs(["--resume=a", "--resume=b"]), /conflict/i);
  assert.throws(() => claudeLaunchArgs(["--continue", "--session-id=a"]), /conflict/i);
  for (const flags of [
    [],
    ["--permission-mode=manual"],
    ["--permission-mode", "default"],
    ["--strict-mcp-config", "--no-chrome"],
  ]) {
    const args = claudeLaunchArgs(flags);
    assert.equal(args.filter((x) => x === "--strict-mcp-config").length, 1);
    assert.equal(args.filter((x) => x === "--permission-mode").length, 1);
    assert.equal(args[args.indexOf("--permission-mode") + 1], "default");
  }
  for (const flags of [
    ["--permission-mode", "bypassPermissions"],
    ["--permission-mode=bypassPermissions"],
    ["--permission-mode=default", "--permission-mode=bypassPermissions"],
    ["--permission-mode", "acceptEdits"],
    ["--permission-mode"],
    ["-phello"],
    ["--mcp-config", "other.json"],
    ["--mcp-config=other.json"],
    ["--strict-mcp-config=false"],
    ["--dangerously-load-development-channels", "server:other"],
    ["--settings", '{"permissions":{"defaultMode":"bypassPermissions"}}'],
    ["--plugin-dir", "/tmp/other"],
    ["--allow-dangerously-skip-permissions"],
  ])
    assert.throws(() => claudeLaunchArgs(flags), /interactive|unsupported|conflict/i, JSON.stringify(flags));
});

test("built stdio adapter survives an owned process crash without replay and releases its port", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "polish-claude-stdio-"));
  await mkdir(path.join(dir, "artifacts"));
  const file = path.join(dir, "artifacts", "fixture.html");
  await writeFile(file, "<!doctype html><p>Fictional stdio review</p>");
  const connections = [];
  t.after(async () => {
    for (const c of connections) await c.client.close();
    await rm(dir, { recursive: true, force: true });
  });
  async function connect() {
    const client = new Client({ name: "synthetic-stdio-client", version: "1.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../dist/claude-channel.mjs", import.meta.url))],
      cwd: dir,
      env: { POLISH_CLAUDE_STATE_ROOT: path.join(dir, "state"), LAVISH_AXI_TELEMETRY: "0" },
      stderr: "pipe",
    });
    const events = [];
    client.setNotificationHandler(
      z.object({ method: z.literal("notifications/claude/channel"), params: z.any() }),
      (event) => {
        events.push(event.params);
      },
    );
    await client.connect(transport);
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      const text = /** @type {Array<{type:string,text?:string}>} */ (result.content).find(
        (c) => c.type === "text",
      ).text;
      assert.ok(!result.isError, text);
      return JSON.parse(text);
    };
    const conn = { client, transport, events, call };
    connections.push(conn);
    return conn;
  }
  async function until(read) {
    for (let i = 0; i < 200; i++) {
      const value = await read();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail("stdio state did not converge");
  }
  const session_id = "synthetic-claude-session";
  async function open(c) {
    await c.call("bind_session", { session_id });
    const probe = await until(() => c.events.find((e) => e.meta.event === "polish_channel_probe"));
    await c.call("confirm_channel", { challenge: probe.meta.challenge });
    return c.call("open_review", { session_id, file, open_browser: false });
  }
  const first = await connect(),
    opened = await open(first),
    base = new URL(opened.url).origin;
  const response = await fetch(`${base}/api/${opened.key}/prompts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ review_epoch: 1, prompts: [{ prompt_id: "stdio-message", prompt: "Fictional feedback" }] }),
  });
  assert.equal(response.status, 200);
  const event = await until(() => first.events.find((e) => e.meta.event === "polish_feedback"));
  const request = { ...JSON.parse(event.meta.identity), receipt: event.meta.receipt };
  await until(
    async () => (await first.call("review_status", { session_id, file })).messages[0].state === "host_queued",
  );
  const ownedPid = first.transport.pid;
  assert.ok(Number.isSafeInteger(ownedPid) && ownedPid > 0);
  process.kill(ownedPid, "SIGKILL");
  await until(() => {
    try {
      process.kill(ownedPid, 0);
      return false;
    } catch (error) {
      return error.code === "ESRCH";
    }
  });
  await first.client.close();
  await assert.rejects(fetch(base + "/health"));
  const second = await connect(),
    reopened = await open(second);
  assert.equal(reopened.url, opened.url);
  assert.deepEqual(reopened.binding, opened.binding);
  const state = await second.call("review_status", { session_id, file });
  assert.equal(state.messages[0].state, "unknown");
  assert.equal(second.events.filter((e) => e.meta.event === "polish_feedback").length, 0);
  await second.call("consume_feedback", request);
  await second.call("reply_feedback", { ...request, text: "Late exact protocol reply" });
  assert.equal(
    (await second.call("review_status", { session_id, file })).messages[0].reply.text,
    "Late exact protocol reply",
  );
  await second.client.close();
  await assert.rejects(fetch(base + "/health"));
  const manifest = JSON.parse(await readFile(path.join(dir, "state", session_id, "host", "claude-host.json"), "utf8"));
  assert.equal(manifest.messages.length, 1);
});
