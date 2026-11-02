import test from "node:test";
import assert from "node:assert/strict";
import { createPolishSkillMarkdown, validateSkillMarkdown } from "../src/skill.js";

test("Polish skill is a valid discovery stub pointing at CLI-owned guidance", () => {
  const text = createPolishSkillMarkdown();
  assert.deepEqual(validateSkillMarkdown(text, { directoryName: "polish" }).errors, []);
  assert.match(text, /polish --help/);
  assert.match(text, /polish design/);
  assert.ok(text.length < 4000);
});
