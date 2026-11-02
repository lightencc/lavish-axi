import { appendFileSync, closeSync, fsyncSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import path from "node:path";
import polishExtension from "../../dist/pi-extension.mjs";

export default function tracedPolishExtension(pi) {
  const directory = process.env.POLISH_FINAL_LAUNCH;
  if (!directory) throw new Error("Use this wrapper only through the final-product harness");
  const clockID = `pi:${process.pid}:${randomUUID()}`;
  const now = () => performance.timeOrigin + performance.now();
  const fd = openSync(path.join(directory, "trace.jsonl"), "ax", 0o600);
  const counts = new Map();
  function trace(stage, metadata = {}) {
    const started = performance.now();
    writeFileSync(fd, JSON.stringify({ stage, metadata, clockID, at: now(), pid: process.pid }) + "\n");
    fsyncSync(fd);
    const durableWriteMs = performance.now() - started;
    // Separate measurement: this excludes the overhead bookkeeping and fault-config read below.
    appendFileSync(
      path.join(directory, "instrumentation.jsonl"),
      JSON.stringify({ stage, clockID, at: now(), durableWriteMs }) + "\n",
    );
    let fault;
    try {
      fault = JSON.parse(readFileSync(path.join(directory, "fault.json"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    const identity = { ...metadata, ...metadata.claim };
    if (fault.stage !== stage || Object.entries(fault.match || {}).some(([key, value]) => identity[key] !== value))
      return;
    const count = (counts.get(fault.id) || 0) + 1;
    counts.set(fault.id, count);
    if (count !== (fault.occurrence || 1)) return;
    writeFileSync(
      fd,
      JSON.stringify({
        stage: "fault_kill_self",
        metadata: { fault, matched: identity },
        clockID,
        at: now(),
        pid: process.pid,
      }) + "\n",
    );
    fsyncSync(fd);
    process.kill(process.pid, "SIGKILL");
  }
  polishExtension(pi, { trace });
  pi.registerCommand("polish-verify-clock", {
    description: "Test-only clock witness; does not call the model",
    handler: (nonce, ctx) => {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(nonce)) throw new Error("Invalid calibration nonce");
      ctx.ui.notify(`POLISH_VERIFY_CLOCK ${JSON.stringify({ nonce, clockID, at: now() })}`, "info");
    },
  });
  pi.on("session_start", (_event, ctx) => {
    const ready = {
      pid: process.pid,
      session: ctx.sessionManager.getSessionId(),
      sessionFile: ctx.sessionManager.getSessionFile(),
      endpoint: process.env.POLISH_PI_ENDPOINT,
      clockID,
      at: now(),
    };
    writeFileSync(path.join(directory, "ready.json"), JSON.stringify(ready, null, 2), { flag: "wx", mode: 0o600 });
    trace("harness_ready", ready);
  });
  pi.on("session_shutdown", () => closeSync(fd));
}
