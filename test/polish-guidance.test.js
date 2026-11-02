import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPolishSkillMarkdown } from "../src/skill.js";
import { createPolishPlaybookOutput, runPolish } from "../src/polish-cli.js";
import { findPlaybook } from "../src/playbooks.js";

function guidance(...args) {
  const stateDir = mkdtempSync(join(tmpdir(), "polish-guidance-"));
  try {
    const result = spawnSync(process.execPath, ["bin/polish.js", ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        POLISH_ENDPOINT: "",
        POLISH_PI_ENDPOINT: "",
        LAVISH_AXI_TELEMETRY: "0",
        LAVISH_AXI_STATE_DIR: stateDir,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
}

test("Polish design is standalone guidance for direct in-place comments", () => {
  const output = guidance("design");
  assert.match(output, /就地浮窗/);
  assert.match(output, /无数字圆球/);
  assert.match(output, /手动刷新/);
  assert.match(output, /用户.*完成/);
  assert.doesNotMatch(output, /sidebarSend|Queue this answer|design_priority/);
});

test("Polish input guidance does not choose a form submission unit or default to a queue sidebar", () => {
  const output = guidance("playbook", "input");
  assert.match(output, /整表.*逐项.*确认/);
  assert.match(output, /兼容/);
  assert.match(output, /queuePrompt/);
  assert.match(output, /scope.*session/);
  assert.doesNotMatch(output, /Queue this answer|Queue answer button|Send to Agent|data-lavish-annotate=\\?"off/);
});

test("Polish lists existing playbook IDs and keeps generic content guidance", () => {
  assert.match(guidance("playbook"), /diagram/);
  const table = guidance("playbook", "table");
  assert.match(table, /semantic table markup/);
  assert.doesNotMatch(table, /control that queues a specific prompt/);
});

test("Polish skill identifies Polish-owned guidance without duplicating its interaction contract", () => {
  const skill = createPolishSkillMarkdown();
  assert.match(skill, /Polish-specific/);
  assert.doesNotMatch(skill, /Lavish Editor opens/);
  assert.ok(skill.length < 4000);
});

test("Polish guidance leaves upstream compatibility playbooks untouched", () => {
  const original = JSON.stringify(findPlaybook("input"));
  createPolishPlaybookOutput("input");
  assert.equal(JSON.stringify(findPlaybook("input")), original);
  assert.match(original, /Queue this answer/);
  assert.throws(() => createPolishPlaybookOutput("missing"), /Unknown playbook/);
});

test("Polish host-bound guidance needs no endpoint connection", async (t) => {
  const output = [];
  t.mock.method(console, "log", (value) => output.push(value));
  await runPolish(["design"], { POLISH_PI_ENDPOINT: "http://127.0.0.1:1" });
  await runPolish(["playbook", "input"], { POLISH_ENDPOINT: "http://127.0.0.1:1" });
  assert.match(output[0], /就地浮窗/);
  assert.match(output[1], /整表.*逐项.*确认/);
});

test("Polish distinguishes decision forms from structured technical writing", () => {
  for (const id of [undefined, "input", "plan", "explanation"]) {
    const output = JSON.stringify(createPolishPlaybookOutput(id));
    assert.match(output, /需要用户决策.*清晰选项加补充说明/);
    assert.match(output, /需求、计划和开发文档.*结构化技术写作.*不强制表单化/);
    assert.match(output, /两类内容都保留就地评论、追问和圆球/);
  }
});
