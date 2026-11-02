import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { polishRequest } from "../src/polish-cli.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const cli = (args) => {
  const dir = mkdtempSync(path.join(tmpdir(), "polish-cli-help-"));
  try {
    return spawnSync(process.execPath, ["bin/polish.js", ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        POLISH_PI_ENDPOINT: "",
        POLISH_ENDPOINT: "",
        LAVISH_AXI_STATE_DIR: dir,
        LAVISH_AXI_TELEMETRY: "0",
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
test("polish help and design work without starting a host", () => {
  const help = cli(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /polish/);
  assert.match(help.stdout, /original Lavish CLI/);
  const design = cli(["design"]);
  assert.equal(design.status, 0);
  assert.match(design.stdout, /飞书/);
});
test("polish without an endpoint validates an existing artifact through the original CLI", () => {
  const result = cli(["artifact.html"]);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /请在当前 Pi/);
  assert.match(result.stderr + result.stdout, /artifact.html|ENOENT|not found/);
});

test("conflicting generic and Pi endpoints cannot send to a different current session", async () => {
  await assert.rejects(
    polishRequest("/health", undefined, {
      POLISH_ENDPOINT: "http://127.0.0.1:1",
      POLISH_PI_ENDPOINT: "http://127.0.0.1:2",
    }),
    /Conflicting/,
  );
  await assert.rejects(
    polishRequest("/health", undefined, { POLISH_ENDPOINT: "http://external.example:80" }),
    /loopback/,
  );
});
