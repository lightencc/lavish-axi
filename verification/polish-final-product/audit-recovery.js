import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const [runArg, stage, id] = process.argv.slice(2);
const run = path.resolve(runArg);
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const before = read(path.join(run, "snapshots", "before-resume.json"));
const after = read(path.join(run, "snapshots", "after-resume.json"));
const trace = [],
  ready = [];
for (const name of readdirSync(path.join(run, "launches"))) {
  const directory = path.join(run, "launches", name);
  try {
    ready.push(read(path.join(directory, "ready.json")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  trace.push(
    ...readFileSync(path.join(directory, "trace.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  );
}
const checks = [];
const check = (name, fn) => {
  fn();
  checks.push(name);
};
const result = { run, stage, id, capturedAt: new Date().toISOString(), pass: false, checks };
try {
  check("real crash fired at exact requested source stage", () =>
    assert.ok(
      trace.some(
        (e) =>
          e.stage === "fault_kill_self" &&
          e.metadata.fault.stage === stage &&
          (stage === "end_sealed" || e.metadata.matched.id === id),
      ),
    ),
  );
  check("same session and same URL endpoint after owned restart", () => {
    assert.ok(ready.length >= 2);
    assert.equal(new Set(ready.map((r) => r.endpoint)).size, 1);
    assert.equal(new Set(ready.map((r) => r.session)).size, 1);
    assert.equal(new Set(ready.map((r) => r.sessionFile)).size, 1);
  });
  if (stage === "end_sealed") {
    check("fixed final and marker batch preserved", () => {
      assert.equal(before.review.lifecycle, "ending");
      assert.equal(after.review.lifecycle, "ended");
      assert.deepEqual(after.review.end, before.review.end);
      assert.equal(after.review.messages.length, 2);
      assert.deepEqual(
        after.review.messages.map((m) => m.id),
        before.review.end.ids,
      );
      assert.ok(after.review.messages.every((m) => m.consumed));
      for (const message of after.review.messages)
        assert.equal(after.inputs.filter((e) => e.details.id === message.id).length, 1);
    });
  } else {
    const old = before.review.messages.find((m) => m.id === id);
    const current = after.review.messages.find((m) => m.id === id);
    check("single durable logical message and single exact Pi input", () => {
      assert.ok(old && current);
      assert.equal(after.review.messages.filter((m) => m.id === id).length, 1);
      assert.equal(after.host.messages.filter((m) => m.claim.id === id).length, 1);
      assert.equal(after.inputs.filter((e) => e.details.id === id).length, 1);
      assert.equal(trace.filter((e) => e.stage === "host_dispatching" && e.metadata.id === id).length, 1);
    });
    if (stage === "input_consumed") {
      check("interrupted execution recovered as unknown without resubmission", () => {
        assert.equal(current.consumed, true);
        assert.equal(current.executionUnknown, true);
        assert.equal(current.reply, undefined);
        assert.equal(before.host.messages.find((m) => m.claim.id === id).state, "processing");
        assert.equal(trace.filter((e) => e.stage === "model_start" && e.metadata.id === id).length, 0);
      });
    } else {
      check("exact reply recovered", () => {
        assert.equal(current.state, "replied");
        assert.ok(current.reply?.text);
      });
      if (stage === "accepted_durable")
        check("crash preceded dispatch", () => {
          assert.equal(old.state, "accepted");
          assert.equal(before.host?.messages.length || 0, 0);
        });
      if (stage === "host_admitted")
        check("admission persisted before lost receipt", () =>
          assert.equal(before.host.messages.find((m) => m.claim.id === id).state, "accepted"),
        );
      if (stage === "host_reply_persisted")
        check("host reply repaired missing review reply without another model turn", () => {
          assert.equal(old.reply, undefined);
          const hostReply = before.host.messages.find((m) => m.claim.id === id).reply;
          assert.equal(current.reply.text, hostReply.text);
          assert.equal(current.reply.evidenceId, hostReply.entryId);
          assert.equal(trace.filter((e) => e.stage === "model_start" && e.metadata.id === id).length, 1);
        });
    }
  }
  result.pass = true;
} catch (error) {
  result.error = error.stack;
  process.exitCode = 1;
}
writeFileSync(path.join(run, "recovery-audit.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
