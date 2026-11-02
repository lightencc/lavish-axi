#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClaudeChannel } from "../src/claude-channel.js";

const channel = createClaudeChannel();
const stop = async () => {
  await channel.close();
  process.exitCode = 0;
};
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
process.stdin.once("end", () => void stop());
await channel.connect(new StdioServerTransport());
