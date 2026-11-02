import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const launch = path.resolve(process.argv[2]);
const uiFile = path.resolve(process.argv[3]);
const ui = JSON.parse(readFileSync(uiFile, "utf8"));
const trace = readFileSync(path.join(launch, "trace.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
const json = (name) => JSON.parse(readFileSync(path.join(launch, name), "utf8"));
const files = readdirSync(launch);
const sourceCalibrations = files.filter((name) => /^(?:source-)?calibration(?:-.*)?\.json$/.test(name)).map(json);
const browserCalibrations = files.filter((name) => /^browser-calibration-.*\.json$/.test(name)).map(json)
  .filter((calibration) => calibration.best.browserClockID === ui.browserClock);
assert.ok(sourceCalibrations.length && browserCalibrations.length, "both clocks need real calibration");
const sourceClock = sourceCalibrations[0].best.sourceClockID;
const supervisorClock = sourceCalibrations[0].best.supervisorClockID;
assert.ok(sourceCalibrations.every((c) => c.best.sourceClockID === sourceClock && c.best.supervisorClockID === supervisorClock));
assert.ok(browserCalibrations.every((c) => c.best.supervisorClockID === supervisorClock));
const browserOrigin = browserCalibrations[0].best.browserTimeOrigin;
// Envelope both ends of the run and allow 1ms for browser timer quantization. No percentile subtraction.
const sourceLow = Math.min(...sourceCalibrations.map((c) => c.best.offsetLowerMs));
const sourceHigh = Math.max(...sourceCalibrations.map((c) => c.best.offsetUpperMs));
const browserLow = Math.min(...browserCalibrations.map((c) => c.best.offsetLowerMs)) - 1;
const browserHigh = Math.max(...browserCalibrations.map((c) => c.best.offsetUpperMs)) + 1;
const offsetLow = sourceLow - browserHigh;
const offsetHigh = sourceHigh - browserLow;
const quantiles = (input) => {
  const values = input.filter(Number.isFinite).sort((a, b) => a - b);
  const q = (p) => values.length ? values[Math.ceil(values.length * p) - 1] : null;
  return { n: values.length, p50: q(0.5), p95: q(0.95), max: values.at(-1) ?? null };
};
const stages = (row, stage) => trace.filter((event) => event.stage === stage && event.clockID === sourceClock
  && event.metadata.id === row.id && event.metadata.epoch === row.reply?.claim?.epoch
  && event.metadata.artifact === row.reply?.claim?.artifact);
const observations = ui.rows.map((row) => {
  const intervals = {};
  for (const [stage, browserDelta] of [["input_consumed", row.consumedVisibleMs], ["reply_persisted", row.replyVisibleMs]]) {
    const matching = stages(row, stage);
    if (matching.length !== 1 || !Number.isFinite(browserDelta) || !Number.isFinite(row.submitBrowserMs)) {
      intervals[stage] = { unavailable: true, sourceEvents: matching.length };
      continue;
    }
    const difference = browserOrigin + row.submitBrowserMs + browserDelta - matching[0].at;
    intervals[stage] = {
      lowerMs: difference + offsetLow,
      estimateMs: difference + (offsetLow + offsetHigh) / 2,
      upperMs: difference + offsetHigh,
    };
  }
  return { index: row.index, id: row.id, kind: row.kind, ...intervals };
});
const report = {
  launch, uiFile, sourceClock, browserClock: ui.browserClock, supervisorClock,
  calibration: { sourceCalibrations: sourceCalibrations.length, browserCalibrations: browserCalibrations.length,
    sourceMinusBrowserLowerMs: offsetLow, sourceMinusBrowserUpperMs: offsetHigh,
    method: "Bracketed source/browser offsets to the same supervisor; envelope pre/post samples plus 1ms browser quantization. Intervening drift is not independently observed." },
  inputSamples: ui.rows.length, allCompleted: ui.allCompleted,
  unsuccessful: ui.rows.filter((row) => row.error || !row.reply).map((row) => ({ index: row.index, error: row.error || "incomplete" })),
  uiFeedbackMs: quantiles(ui.rows.map((row) => row.uiFeedbackMs)),
  uiAcknowledgementMs: quantiles(ui.rows.map((row) => row.uiAckMs)),
  uiCompleteReplyMs: quantiles(ui.rows.map((row) => row.replyVisibleMs)),
  intervals: Object.fromEntries(["input_consumed", "reply_persisted"].map((stage) => [stage, {
    estimates: quantiles(observations.map((row) => row[stage]?.estimateMs)),
    upperBounds: quantiles(observations.map((row) => row[stage]?.upperMs)),
    targetP95Ms: 200,
    passed: observations.length >= 30 && observations.every((row) => Number.isFinite(row[stage]?.upperMs))
      && quantiles(observations.map((row) => row[stage].upperMs)).p95 <= 200,
  }])),
  observations,
  note: "All measurements include tracing cost. Source trace metadata alone proves neither visible UI nor an actual provider processing start.",
};
const destination = path.join(path.dirname(uiFile), "source-to-browser-timing.json");
writeFileSync(destination, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ destination, ...report, observations: undefined }, null, 2));
