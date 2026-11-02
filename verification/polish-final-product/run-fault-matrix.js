import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)),
  execute = promisify(execFile);
const logFile = path.join(root, `fault-driver-${Date.now()}.jsonl`);
const log = (stage, metadata) => {
  const line = JSON.stringify({ at: new Date().toISOString(), stage, metadata });
  appendFileSync(logFile, line + "\n");
  console.log(line);
};
function bounded(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
function launch(args) {
  const child = spawn(process.execPath, [path.join(root, "run.js"), ...args], { stdio: ["pipe", "pipe", "pipe"] });
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const timer = setTimeout(() => rejectReady(new Error("Harness readiness timeout")), 220000);
  const exit = new Promise((resolve) =>
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      rejectReady(new Error(`Harness exited before ready: ${code}/${signal}`));
      resolve({ code, signal });
    }),
  );
  child.on("error", rejectReady);
  createInterface({ input: child.stdout }).on("line", (line) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      log("stdout", { pid: child.pid, line });
      return;
    }
    log("harness", { pid: child.pid, value });
    if (value.ready) {
      clearTimeout(timer);
      resolveReady(value);
    }
  });
  child.stderr.on("data", (chunk) => log("stderr", { pid: child.pid, text: String(chunk) }));
  return { ready, exit, child, send: (body) => child.stdin.write(JSON.stringify(body) + "\n") };
}
async function local(script, args) {
  const result = await execute(process.execPath, [path.join(root, script), ...args]);
  log(script, result.stdout.trim());
}
async function waitState(ready, test) {
  const url = new URL(ready.url),
    key = url.pathname.split("/").at(-1),
    deadline = Date.now() + 180000;
  let state;
  do {
    const response = await fetch(`${url.origin}/api/${key}/review`, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    state = await response.json();
    if (test(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error(`Recovery deadline: ${JSON.stringify(state)}`);
}
const stages = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["accepted_durable", "end_sealed", "host_admitted", "input_consumed", "host_reply_persisted"];
for (const stage of stages) {
  let original, recovered, ready;
  try {
    original = launch(["--warmup", "--fault", path.join(root, "faults", `${stage}.json`)]);
    ready = await original.ready;
    log("scenario_started", { stage, run: ready.run });
    const id = `fault-${stage}`;
    original.send(
      stage === "end_sealed"
        ? { op: "end", text: "Final feedback: do not use tools or modify files; reply OK only." }
        : { op: "submit", id, text: "不要修改文件，不要使用工具，只回复 OK。" },
    );
    const exit = await bounded(original.exit, 180000, "Requested crash boundary did not occur within 180 seconds");
    assert.equal(exit.code, 0, "Supervisor should preserve the Pi self-kill as evidence, then exit cleanly");
    await local("capture.js", [ready.run, "before-resume"]);
    recovered = launch(["--resume", ready.run]);
    const again = await recovered.ready;
    assert.equal(again.url, ready.url);
    await waitState(again, (s) =>
      stage === "end_sealed"
        ? s.lifecycle === "ended"
        : stage === "input_consumed"
          ? s.messages.some((m) => m.id === id && m.consumed && m.executionUnknown)
          : s.messages.some((m) => m.id === id && m.state === "replied"),
    );
    if (stage === "end_sealed") {
      const manifest = JSON.parse(readFileSync(path.join(ready.run, "manifest.json"), "utf8"));
      const u = new URL(again.url);
      const response = await fetch(`${u.origin}/api/${manifest.key}/review/end`, {
        method: "POST",
        headers: { Origin: u.origin, "content-type": "application/json" },
        body: JSON.stringify(manifest.endRequest),
      });
      const body = await response.json();
      writeFileSync(
        path.join(ready.run, "exact-end-retry.json"),
        JSON.stringify({ request: manifest.endRequest, status: response.status, response: body }, null, 2),
      );
      assert.equal(response.status, 200);
    }
    await local("capture.js", [ready.run, "after-resume"]);
    await local("audit-recovery.js", [ready.run, stage, id]);
    const indexFile = path.join(root, "run-index.json"),
      index = JSON.parse(readFileSync(indexFile, "utf8"));
    index.fault_matrix.push({
      stage,
      run: ready.run,
      status: "PASS",
      audit: "recovery-audit.json",
      precondition: "real Pi warm-up persisted session before artifact submission",
    });
    writeFileSync(indexFile, JSON.stringify(index, null, 2));
    log("scenario_pass", { stage, run: ready.run });
  } catch (error) {
    log("scenario_fail", { stage, run: ready?.run, error: error.stack });
    process.exitCode = 1;
    break;
  } finally {
    for (const owned of [recovered, original]) {
      if (!owned || owned.child.exitCode !== null || owned.child.signalCode !== null) continue;
      owned.send({ op: "stop" });
      owned.child.stdin.end();
      await owned.exit;
    }
  }
}
