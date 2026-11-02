import test from "node:test";
import assert from "node:assert/strict";
import { createPollOutput } from "../src/cli.js";

test("bound poll output preserves the delivery identity without moving next_step behind DOM", () => {
  const delivery = { id: "r3-message", attempt: "unique-attempt", generation: 3 };
  const output = createPollOutput({
    file: "/isolated/fixture.html",
    response: {
      status: "feedback",
      prompts: [{ prompt: "Whole page" }],
      delivery,
      artifact_failures: [{ kind: "artifact-unavailable" }],
      dom_snapshot: "large DOM",
    },
  });
  assert.deepEqual(output.delivery, delivery);
  const keys = Object.keys(output);
  assert.ok(keys.indexOf("prompts") < keys.indexOf("artifact_failures"));
  assert.ok(keys.indexOf("artifact_failures") < keys.indexOf("next_step"));
  assert.ok(keys.indexOf("next_step") < keys.indexOf("dom_snapshot"));
  assert.equal(
    "delivery" in createPollOutput({ file: "/isolated/fixture.html", response: { status: "feedback", prompts: [] } }),
    false,
  );
});
