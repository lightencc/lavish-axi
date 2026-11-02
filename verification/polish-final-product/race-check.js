import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const run = path.resolve(process.argv[2]);
const manifest = JSON.parse(readFileSync(path.join(run, "manifest.json"), "utf8"));
assert.equal(manifest.run, run);
const ready = JSON.parse(readFileSync(path.join(manifest.launch, "ready.json"), "utf8"));
const base = ready.endpoint,
  key = manifest.key;
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.ok(key);
const prior = process.argv.includes("--continue")
  ? JSON.parse(readFileSync(path.join(run, "race-evidence.json"), "utf8"))
  : null;
const evidence = {
  run,
  ready,
  requests: [],
  checks: [],
  pass: false,
  priorEvidence: prior ? "race-evidence.json" : null,
};
const save = () =>
  writeFileSync(
    path.join(run, prior ? "race-continuation.json" : "race-evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
async function request(route, body) {
  const row = { route, method: body ? "POST" : "GET", body, startedAt: new Date().toISOString() };
  evidence.requests.push(row);
  save();
  const response = await fetch(base + route, {
    ...(body
      ? { method: "POST", headers: { Origin: base, "content-type": "application/json" }, body: JSON.stringify(body) }
      : { headers: { Origin: base } }),
    signal: AbortSignal.timeout(10000),
  });
  row.status = response.status;
  row.response = await response.json();
  row.finishedAt = new Date().toISOString();
  save();
  return row;
}
const check = (name, fn) => {
  fn();
  evidence.checks.push(name);
  save();
};
try {
  const before = prior ? prior.requests[0].response : (await request(`/api/${key}/review`)).response;
  if (!prior) {
    check("real busy inputs exist while competing poll starts", () =>
      assert.ok(before.messages.some((m) => !m.consumed)),
    );
    const query = new URLSearchParams({ file: manifest.artifact, timeoutMs: "1" });
    for (const takeover of [false, true]) {
      const poll = await request(`/api/poll?${query}${takeover ? "&takeover=1" : ""}`, takeover ? {} : undefined);
      check(`${takeover ? "POST takeover" : "GET"} poll refused in bridge mode`, () => {
        assert.ok(poll.status >= 400);
        assert.match(JSON.stringify(poll.response), /MODE/);
      });
    }
    const postPoll = (await request(`/api/${key}/review`)).response;
    check("poll cannot change bridge ownership or logical message set", () => {
      assert.equal(postPoll.mode, "bridge");
      assert.equal(postPoll.generation, before.generation);
      assert.deepEqual(
        postPoll.messages.map((m) => m.id),
        before.messages.map((m) => m.id),
      );
      for (const old of before.messages.filter((m) => m.claim))
        assert.equal(postPoll.messages.find((m) => m.id === old.id).claim.attempt, old.claim.attempt);
    });
  }
  const id = prior?.endRequest.id || randomUUID(),
    raceID = prior?.racePrompt.prompts[0].prompt_id || randomUUID();
  const end = prior?.endRequest || {
    id,
    epoch: before.epoch,
    final: {
      id: randomUUID(),
      epoch: before.epoch,
      text: "Final feedback: do not modify files or use tools; acknowledge only.",
    },
  };
  const prompt = prior?.racePrompt || {
    review_epoch: before.epoch,
    prompts: [
      {
        prompt_id: raceID,
        round_id: randomUUID(),
        scope: "session",
        prompt: "Concurrent final feedback: do not modify files or use tools; reply OK only.",
      },
    ],
  };
  evidence.endRequest = end;
  evidence.racePrompt = prompt;
  save();
  const [sent, ended] = prior
    ? [
        prior.requests.find((r) => r.route.endsWith("/prompts")),
        prior.requests.find((r) => r.route.endsWith("/review/end")),
      ]
    : await Promise.all([request(`/api/${key}/prompts`, prompt), request(`/api/${key}/review/end`, end)]);
  check("end accepted while concurrent prompt has an explicit disposition", () => {
    assert.equal(ended.status, 200);
    if (prior) assert.deepEqual(sent.response, { error: "CLOSED" });
    else assert.ok(sent.status === 200 || sent.status === 409);
  });
  let after;
  const deadline = Date.now() + 180000;
  do {
    after = (await request(`/api/${key}/review`)).response;
    if (after.lifecycle === "ended") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  check("actual marker consumption ends exactly the accepted set", () => {
    assert.equal(after.lifecycle, "ended");
    const expected = [
      ...before.messages.map((m) => m.id),
      ...(sent.status === 200 ? [raceID] : []),
      end.final.id,
      id + "-marker",
    ];
    assert.deepEqual([...after.end.ids].sort(), expected.sort());
    assert.deepEqual(after.messages.map((m) => m.id).sort(), expected);
    assert.ok(after.messages.every((m) => m.consumed));
  });
  const replay = await request(`/api/${key}/review/end`, end);
  check("identical end replay preserves the fixed batch", () => {
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.response.end, after.end);
    assert.equal(replay.response.messages.length, after.messages.length);
  });
  const altered = await request(`/api/${key}/review/end`, {
    ...end,
    final: { ...end.final, text: "Changed final feedback" },
  });
  check("same end identity with changed payload is rejected", () => {
    assert.equal(altered.status, 409);
    assert.match(JSON.stringify(altered.response), /CONFLICT/);
  });
  const disk = JSON.parse(readFileSync(path.join(run, "polish-state", manifest.session, "host", "host.json"), "utf8"));
  const entries = readFileSync(manifest.sessionFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  check("each sealed id has one host admission and one real Pi input", () => {
    for (const messageID of after.end.ids) {
      assert.equal(disk.messages.filter((m) => m.claim.id === messageID).length, 1);
      assert.equal(
        entries.filter(
          (e) => e.type === "custom_message" && e.customType === "polish-input" && e.details.id === messageID,
        ).length,
        1,
      );
    }
  });
  evidence.pass = true;
} catch (error) {
  evidence.error = error.stack;
  process.exitCode = 1;
}
save();
console.log(JSON.stringify({ pass: evidence.pass, checks: evidence.checks, error: evidence.error }, null, 2));
