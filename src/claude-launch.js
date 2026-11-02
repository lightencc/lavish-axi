import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// Arguments only: never install persistent MCP configuration or accept channel warnings.
export function claudeLaunchArgs(argv, root = new URL("../dist/", import.meta.url)) {
  // Do not pass arbitrary flags through: equivalent permission/configuration flags
  // can override our defaults, including values supplied through --settings.
  const values = new Set(["--resume", "--session-id", "--model", "--effort", "--name", "--permission-mode"]);
  const switches = new Set(["--continue", "--verbose", "--strict-mcp-config", "--no-chrome"]);
  const aliases = new Map([
    ["-c", "--continue"],
    ["-n", "--name"],
  ]);
  const options = new Map();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i],
      equal = arg.indexOf("=");
    const raw = equal < 0 ? arg : arg.slice(0, equal);
    const name = aliases.get(raw) || raw;
    if (!values.has(name) && !switches.has(name))
      throw new Error(
        `Unsupported interactive option: ${raw}. Use --resume, --continue, --session-id, --model, --effort, --name or --verbose; enter prompts in the session.`,
      );
    let value = "";
    if (values.has(name)) {
      value = equal < 0 ? argv[++i] : arg.slice(equal + 1);
      if (!value || value.startsWith("-")) throw new Error(`Unsupported or missing interactive value for ${name}`);
    } else if (equal >= 0) throw new Error(`Unsupported interactive value for ${name}`);
    if (name === "--permission-mode") {
      if (!["default", "manual"].includes(value))
        throw new Error("Conflicting permission mode: use default/manual interactive permissions only");
      value = "default";
    }
    if (options.has(name) && options.get(name) !== value) throw new Error(`Conflicting interactive option: ${name}`);
    options.set(name, value);
  }
  if (["--resume", "--continue", "--session-id"].filter((name) => options.has(name)).length > 1)
    throw new Error("Conflicting interactive session selectors");
  for (const name of ["--permission-mode", "--strict-mcp-config", "--no-chrome"]) options.delete(name);
  const forwarded = [...options].flatMap(([name, value]) => (value ? [name, value] : [name]));
  const server = fileURLToPath(new URL("claude-channel.mjs", root));
  const skills = fileURLToPath(new URL("claude-plugin/", root));
  if (!existsSync(server) || !existsSync(new URL("claude-plugin/.claude/skills/polish/SKILL.md", root)))
    throw new Error("Build the adapter first: pnpm run build");
  return [
    "--strict-mcp-config",
    "--permission-mode",
    "default",
    "--no-chrome",
    "--mcp-config",
    JSON.stringify({ mcpServers: { polish: { command: process.execPath, args: [server] } } }),
    "--add-dir",
    skills,
    "--dangerously-load-development-channels",
    "server:polish",
    ...forwarded,
  ];
}
