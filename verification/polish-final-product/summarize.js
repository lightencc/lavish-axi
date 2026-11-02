import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const run = path.resolve(process.argv[2] || "missing-run-directory");
const uiFile = process.argv[3] ? path.resolve(process.argv[3]) : null;
const selectedLaunch = process.argv[4] || null;
const ui = uiFile ? JSON.parse(readFileSync(uiFile, "utf8")) : null;
if (ui) assert.ok(selectedLaunch, "Filtered UI summary requires its exact launch name");
const identityKey = (identity) => JSON.stringify([identity.artifact, identity.epoch, identity.id]);
const selected = ui ? new Set(ui.rows.map((row) => identityKey({ ...row.reply?.claim, id: row.id }))) : null;
if (selected) assert.equal(selected.size, ui.rows.length, "UI identities must be unique");
const read = (file) => {
  try {
    return readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};
const quantiles = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (q) => (sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] : null);
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? null };
};
const report = {
  run,
  selection: ui
    ? {
        uiFile,
        launch: selectedLaunch,
        identities: [...selected].map(JSON.parse),
        inputSamples: ui.rows.length,
        unsuccessful: ui.rows
          .filter((row) => row.status !== "completed")
          .map((row) => ({ index: row.index, error: row.error || "incomplete" })),
      }
    : null,
  measurement:
    "Raw stage durations subtract only matching clockIDs. model_start is Pi before_provider_request, not provider processing start. Calibration retains bounded source-minus-supervisor offsets separately.",
  launches: [],
};
for (const name of readdirSync(path.join(run, "launches"))) {
  if (selectedLaunch && name !== selectedLaunch) continue;
  const directory = path.join(run, "launches", name);
  const client = read(path.join(directory, "client.jsonl"));
  const trace = read(path.join(directory, "trace.jsonl"));
  const overhead = read(path.join(directory, "instrumentation.jsonl")).filter((sample) => {
    if (!selected) return true;
    // Instrumentation is written synchronously immediately after its source trace record.
    const source = trace.findLast((event) => event.clockID === sample.clockID && event.at <= sample.at);
    return (
      source?.stage === sample.stage && selected.has(identityKey({ ...source.metadata, ...source.metadata.claim }))
    );
  });
  const direct = client.filter((e) => e.stage === "direct_sample" && e.metadata.stopReason === "stop");
  const attempted = client.filter((e) => e.stage === "direct_sample_started");
  const failed = client.filter((e) => e.stage === "direct_sample_failed");
  const finishedIDs = new Set([...direct, ...failed].map((e) => e.metadata.sampleID));
  const incomplete = attempted.filter((e) => !finishedIDs.has(e.metadata.sampleID));
  const review = client.filter((e) => e.stage === "review_sample");
  const groups = new Map();
  for (const event of trace) {
    const identity = { ...event.metadata, ...event.metadata.claim };
    if (!identity.id || (selected && !selected.has(identityKey(identity)))) continue;
    const groupKey = JSON.stringify([event.clockID, identity.artifact, identity.epoch, identity.id]);
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push({ ...event, identity });
  }
  const intervals = {};
  const stagePairs = [
    ["accepted_durable", "host_admitted"],
    ["accepted_durable", "dispatch_reserved"],
    ["dispatch_reserved", "host_admitted"],
    ["host_admitted", "host_dispatching"],
    ["host_dispatching", "input_consumed"],
    ["input_consumed", "model_start"],
    ["input_consumed", "first_token"],
    ["first_token", "host_reply_persisted"],
    ["host_reply_persisted", "reply_persisted"],
  ];
  for (const [from, to] of stagePairs) {
    const values = [];
    for (const rows of groups.values()) {
      // Keep only unambiguous pairs; retries are not silently merged into a successful sample.
      const left = rows.filter((e) => e.stage === from),
        right = rows.filter((e) => e.stage === to);
      if (left.length !== 1 || right.length !== 1) continue;
      if (
        left[0].identity.attempt &&
        right[0].identity.attempt &&
        left[0].identity.attempt !== right[0].identity.attempt
      )
        continue;
      if (right[0].at >= left[0].at) values.push(right[0].at - left[0].at);
    }
    intervals[`${from}->${to}`] = quantiles(values);
  }
  report.launches.push({
    name,
    builds: client.filter((e) => e.stage === "build_identity").map((e) => e.metadata),
    directEnough: direct.length >= 30,
    directAttempts: attempted.length,
    directSuccessful: direct.length,
    directFailed: failed.map((e) => e.metadata),
    directIncomplete: incomplete.map((e) => e.metadata),
    directBatches: client
      .filter((e) => e.stage === "direct_batch_started")
      .map((e) => ({
        ...e.metadata,
        started: attempted.filter((s) => s.metadata.batchID === e.metadata.batchID).length,
        successful: direct.filter((s) => s.metadata.batchID === e.metadata.batchID).length,
        notStarted: e.metadata.requested - attempted.filter((s) => s.metadata.batchID === e.metadata.batchID).length,
      })),
    clockCalibration: client.filter((e) => e.stage === "clock_calibration").map((e) => e.metadata),
    browserClockCalibration: client.filter((e) => e.stage === "browser_clock_calibration").map((e) => e.metadata),
    ...(ui
      ? {
          uiSamples: ui.rows.length,
          uiEnough: ui.rows.length >= 30 && ui.rows.every((row) => row.status === "completed"),
          rpcReviewEnough: review.length >= 30,
        }
      : { reviewEnough: review.length >= 30 }),
    directFirstTokenMs: quantiles(direct.map((e) => e.metadata.firstTokenMs)),
    directTotalMs: quantiles(direct.map((e) => e.metadata.totalMs)),
    [ui ? "rpcReviewObservedReplyMs" : "reviewObservedReplyMs"]: quantiles(review.map((e) => e.metadata.elapsedMs)),
    instrumentationDurableWriteMs: quantiles(overhead.map((e) => e.durableWriteMs)),
    instrumentationScope: selected
      ? "Exact selected UI identities, matched to each synchronous immediately preceding source trace record; readiness and cleanup excluded."
      : "Entire launch.",
    instrumentationLimitation:
      "Durable write time includes trace JSON encoding/write/fsync, excludes the secondary overhead log and fault-config lookup. Do not subtract this instrumentation cost from reported wall latency.",
    intervals,
    faults: trace.filter((e) => e.stage === "fault_kill_self"),
    issues: client.filter((e) => ["startup_error", "command_error", "pi_exit"].includes(e.stage)),
  });
}
if (selectedLaunch) assert.equal(report.launches.length, 1, "Selected launch must exist");
writeFileSync(path.join(run, ui ? "final-ui-source-summary.json" : "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
