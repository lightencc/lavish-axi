import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./server.js";
import { createPiHost } from "./pi-host.js";
import { polishRequest } from "./polish-cli.js";

export default function polishExtension(pi, { trace = (_stage, _metadata) => {} } = {}) {
  let service, host;
  const previousEndpoint = process.env.POLISH_PI_ENDPOINT;
  async function close() {
    await service?.close();
    service = undefined;
    host?.close();
    host = undefined;
    if (previousEndpoint === undefined) delete process.env.POLISH_PI_ENDPOINT;
    else process.env.POLISH_PI_ENDPOINT = previousEndpoint;
  }
  pi.on("session_start", async (_event, ctx) => {
    await close();
    const session = ctx.sessionManager.getSessionId();
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(session)) throw new Error("Invalid Pi session identity");
    const root = process.env.POLISH_PI_STATE_ROOT || path.join(homedir(), ".polish-axi", "pi");
    const directory = path.join(root, session);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    host = await createPiHost(pi, ctx, path.join(directory, "host"), { trace });
    try {
      service = await serve({
        port: host.port,
        hosts: ["127.0.0.1"],
        host: "127.0.0.1",
        linkHost: "127.0.0.1",
        stateFile: path.join(directory, "state.json"),
        version: "0.1.96-pi.1",
        polishHost: host,
        polishTrace: trace,
        idleTimeoutMs: null,
        detectTailscale: async () => null,
        env: { ...process.env, LAVISH_AXI_HOST: "127.0.0.1", LAVISH_AXI_ALLOWED_HOSTS: "", LAVISH_AXI_TELEMETRY: "0" },
      });
      host.setPort(service.port);
      process.env.POLISH_PI_ENDPOINT = `http://127.0.0.1:${service.port}`;
      await service.review.recover();
      host.start();
      ctx.ui.notify(`Polish 已绑定当前 Pi session。使用 /polish <HTML 路径> 打开评审。`, "info");
    } catch (error) {
      await close();
      throw error;
    }
  });
  pi.on("session_shutdown", close);
  pi.on("session_before_switch", close);
  pi.registerCommand("polish", {
    description: "在当前 Pi 会话打开 HTML 评审（文字选区、整体意见和原生表单）",
    handler: async (args, ctx) => {
      const reopen = /(?:^|\s)--reopen(?:\s|$)/.test(args);
      const noOpen = /(?:^|\s)--no-open(?:\s|$)/.test(args);
      const file = args
        .replace(/(?:^|\s)--(?:reopen|no-open)(?=\s|$)/g, "")
        .trim()
        .replace(/^"(.*)"$/, "$1");
      if (!file) {
        ctx.ui.notify("用法：/polish /absolute/path/artifact.html [--reopen]", "info");
        return;
      }
      const result = await polishRequest(
        "/api/sessions",
        { file: path.resolve(ctx.cwd, file), reopen },
        { POLISH_PI_ENDPOINT: process.env.POLISH_PI_ENDPOINT },
      );
      ctx.ui.notify(`${result.status}: ${result.url}`, "info");
      if (result.status === "opened" && !noOpen) {
        const { default: open } = await import("open");
        await open(result.url);
      }
    },
  });
  pi.on("before_agent_start", (event) => {
    const cli = fileURLToPath(
      new URL(import.meta.url.endsWith(".mjs") ? "./polish" : "../bin/polish.js", import.meta.url),
    );
    return {
      systemPrompt:
        event.systemPrompt +
        `\nFor HTML review use the current-session Polish CLI: node ${JSON.stringify(cli)} <file.html> --no-open. Run its design command before generating a new HTML. Feedback is delivered automatically; do not poll, spawn another agent, or manually reply to the review server. Final assistant responses are linked by the Pi extension. Preserve existing artifact styling unless requested.`,
    };
  });
}
