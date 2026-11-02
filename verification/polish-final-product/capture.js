import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const run = path.resolve(process.argv[2]);
const label = process.argv[3];
assert.match(label, /^[a-z0-9_-]+$/);
const manifest = JSON.parse(readFileSync(path.join(run, "manifest.json"), "utf8"));
assert.equal(manifest.schema, "polish-final-product-v1");
assert.equal(manifest.run, run);
const directory = path.join(run, "polish-state", manifest.session);
const files = {};
function read(file, fallback = null) {
  try {
    const text = readFileSync(file, "utf8");
    files[file] = createHash("sha256").update(text).digest("hex");
    return text;
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}
const store = JSON.parse(read(path.join(directory, "state.json")));
const session = Object.values(store.sessions).find((s) => s.file === manifest.artifact);
assert.ok(session, "Only the run's own artifact may be captured");
const hostText = read(path.join(directory, "host", "host.json"));
const transcript = (read(manifest.sessionFile, "") || "")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const snapshot = {
  capturedAt: new Date().toISOString(),
  manifest,
  files,
  review: session.review_delivery,
  host: hostText ? JSON.parse(hostText) : null,
  inputs: transcript.filter((entry) => entry.type === "custom_message" && entry.customType === "polish-input"),
  assistants: transcript.filter((entry) => entry.type === "message" && entry.message?.role === "assistant"),
};
mkdirSync(path.join(run, "snapshots"), { recursive: true });
writeFileSync(path.join(run, "snapshots", `${label}.json`), JSON.stringify(snapshot, null, 2), { flag: "wx" });
console.log(
  JSON.stringify({
    label,
    lifecycle: snapshot.review.lifecycle,
    messages: snapshot.review.messages.map((m) => ({
      id: m.id,
      state: m.state,
      consumed: m.consumed,
      executionUnknown: m.executionUnknown,
      reply: !!m.reply,
    })),
    inputCount: snapshot.inputs.length,
  }),
);
