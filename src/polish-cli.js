import { randomUUID } from "node:crypto";
import { resolveAllowedArtifactFile } from "./artifact-path.js";
import { sessionKey } from "./session-store.js";

// Polish owns its generation guidance; upstream playbooks remain unchanged for
// existing Lavish pages and their explicit queue/batch workflows.
import { findPlaybook, listPlaybooks } from "./playbooks.js";

export const POLISH_INTERACTION = `评审主流程：选中文字或点击内容块 → 就地浮窗 → 一次发送 → 接收后收为无数字圆球。点击圆球在同一浮窗查看回复和追问。手动刷新查看修改；agent 回复不自动完成，只有用户勾选完成才消球。不要生成“加入待发送 → 到侧栏统一发送”的必经主流程，也不要在 artifact 内重做评论浮窗或常驻聊天侧栏。评论由 Polish 评论层提供，默认可用；原生表单、按钮、链接和可编辑区域保留自身交互。`;

export const POLISH_FORM_GUIDANCE = `表单选择变化只更新本地状态，不发送。保留原生控件、稳定 data-lavish-question、结构化 question/answers 和已有 queueKey 语义。整表一次提交还是逐项提交必须由用户确认，未确认时不要自行选定或生成提交处理器。已有 queuePrompt / sendQueuedPrompts 队列、替换、批次和附件接口仅作为兼容能力保留，不改写旧页面，也不把兼容队列入口作为评论主入口。sendQueuedPrompts() 会发送现有队列，不应把它描述成只发送当前答案。整体意见和普通整页表单使用 scope: 'session'，不传 element/selector/quote，不生成锚定圆球；定位评论由评论层负责。`;

export const POLISH_CONTENT_GUIDANCE = `需要用户决策时使用表单交互：清晰选项加补充说明输入，不把表单等同旧队列。整理需求、计划和开发文档时使用结构化技术写作，不强制表单化。两类内容都保留就地评论、追问和圆球；表单控件操作不触发评论。`;

export const POLISH_DESIGN = `新 HTML 固定采用简约飞书风格：白色内容面、浅灰背景、系统无衬线字体、深灰正文、蓝色主操作、细边框与适度圆角。样式写入 HTML，直接打开仍一致。已有 HTML 保留原设计。
${POLISH_CONTENT_GUIDANCE}
${POLISH_INTERACTION}
${POLISH_FORM_GUIDANCE}
使用 polish playbook 列出内容指导；按任务读取匹配的 polish playbook <id>。这些展示指导不改变当前通信、poll/reply/ack、重试或持久化协议。
`;

export function createPolishPlaybookOutput(id) {
  if (!id)
    return {
      playbooks: listPlaybooks(),
      content_guidance: POLISH_CONTENT_GUIDANCE,
      interaction: POLISH_INTERACTION,
    };
  const original = findPlaybook(id);
  if (!original) throw new Error(`Unknown playbook: ${id}. Run polish playbook to list known IDs.`);
  if (id === "input") {
    return {
      playbook: {
        id,
        use_when: original.use_when,
        content_guidance: POLISH_CONTENT_GUIDANCE,
        interaction: POLISH_INTERACTION,
        form_guidance: POLISH_FORM_GUIDANCE,
        design_rules: [
          "让每个问题、选项含义和当前本地选择清晰可见；使用可访问的原生单选、多选、输入框和标签。",
          "保持评论默认可用；原生交互控件无需关闭整页评论。自定义交互控件使用适当 ARIA role 或 data-lavish-action，避免误触评论。",
          "有明确授权的多项批次保留稳定 ID 和逐项回执，不擅自拆分、合并或改变已有提交边界。",
        ],
      },
    };
  }
  const { lavish_notes, ...content } = original;
  return {
    playbook: {
      ...content,
      content_guidance: POLISH_CONTENT_GUIDANCE,
      polish_notes: lavish_notes.filter((note) => !/queue/i.test(note)),
      interaction: POLISH_INTERACTION,
    },
  };
}

export async function polishRequest(route, body, env = process.env) {
  if (env.POLISH_ENDPOINT && env.POLISH_PI_ENDPOINT && env.POLISH_ENDPOINT !== env.POLISH_PI_ENDPOINT)
    throw new Error("Conflicting Polish endpoints: choose the current session explicitly");
  const value = env.POLISH_ENDPOINT || env.POLISH_PI_ENDPOINT;
  if (!value)
    throw new Error(
      "请在当前 Pi 会话加载 Polish 扩展：pi -e ./dist/pi-extension.mjs；Claude Code 使用 polish-claude 启动后 /polish，不会另起 agent 对话。",
    );
  const base = new URL(value);
  if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || base.username || base.password || !base.port)
    throw new Error("Polish endpoint must be a local loopback service");
  const response = await fetch(new URL(route, base), {
    ...(body !== undefined
      ? {
          method: "POST",
          headers: { "content-type": "application/json", Origin: base.origin },
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Polish request failed (${response.status})`);
  return result;
}

export async function runPolish(argv, env = process.env) {
  try {
    const [command = "--help", ...args] = argv;
    // Guidance is host-independent and must not fall through to queue-first
    // upstream generation advice. No runtime delivery path changes here.
    if (command === "design") {
      console.log(POLISH_DESIGN);
      return;
    }
    if (command === "playbook") {
      console.log(JSON.stringify(createPolishPlaybookOutput(args[0]), null, 2));
      return;
    }
    // Pi keeps its explicit bound endpoint. Ordinary agents use the original
    // Lavish CLI/daemon/poll flow; no new agent process or MCP configuration.
    if (!env.POLISH_ENDPOINT && !env.POLISH_PI_ENDPOINT) {
      const { run, normalizeArgv } = await import("./cli.js");
      if (["--help", "-h", "help"].includes(command)) {
        console.log(
          "Polish uses the original Lavish CLI workflow below. Use this same local polish executable wherever guidance says lavish-axi. Generate/save HTML from the request (or open an existing file unchanged), then open → poll → reply/poll → end. No Channels/MCP or special Claude launcher is required. Pi remains available through its bound extension.",
        );
        return run(["--help"]);
      }
      const normalized = normalizeArgv(argv);
      return run(normalized[0] === "open" ? [...normalized, "--polish"] : normalized);
    }
    if (["--help", "-h", "help"].includes(command)) {
      console.log(
        "polish <artifact.html> [--no-open] [--reopen]\npolish status <artifact.html>\npolish end <artifact.html>\npolish design\n\n绑定当前 Pi 会话；先加载 dist/pi-extension.mjs。网页反馈自动唤醒当前 agent，回复由 Pi 扩展精确关联，无需 poll。整页确认/手动结束在网页操作。结束只停止该 HTML 的评审通信。\n",
      );
      return;
    }
    if (["--version", "-v", "-V"].includes(command)) {
      console.log("polish 0.1.96-pi.1");
      return;
    }
    if (!env.POLISH_ENDPOINT && !env.POLISH_PI_ENDPOINT) await polishRequest("/health", undefined, env);
    if (["status", "end"].includes(command)) {
      const file = await resolveAllowedArtifactFile(args[0]);
      const key = sessionKey(file),
        state = await polishRequest(`/api/${key}/review`, undefined, env);
      const result =
        command === "status"
          ? state
          : await polishRequest(`/api/${key}/review/end`, { id: randomUUID(), epoch: state.epoch, final: null }, env);
      console.log(JSON.stringify(result));
      return;
    }
    const file = await resolveAllowedArtifactFile(command === "open" ? args[0] : command);
    const result = await polishRequest("/api/sessions", { file, reopen: args.includes("--reopen") }, env);
    console.log(JSON.stringify(result));
    if (!args.includes("--no-open") && result.status === "opened") {
      const { default: open } = await import("open");
      await open(result.url);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
