#!/usr/bin/env node
import { spawn } from "node:child_process";
import { claudeLaunchArgs } from "../src/claude-launch.js";

const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"));
if (args.includes("--help")) {
  console.log(
    "polish-claude [--resume <id> | --continue | --session-id <id>] [--model <model>] [--effort <level>] [--name <name>] [--verbose]\nStarts an interactive Claude session with only the session-scoped Polish MCP configuration and /polish skill. Sets --strict-mcp-config, --permission-mode default and --no-chrome; does not change persistent settings. Requires explicit development-channel confirmation and supported Anthropic authentication. Configuration overrides, other permission modes, print/background modes and unknown flags are rejected. --permission-mode default/manual, --strict-mcp-config and --no-chrome are accepted as redundant safe options. Use --resume <id> only for your intended stopped session; enter prompts inside the session.",
  );
} else {
  try {
    const child = spawn("claude", claudeLaunchArgs(args), { stdio: "inherit", shell: false });
    child.once("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    child.once("exit", (code) => {
      process.exitCode = code ?? 1;
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
