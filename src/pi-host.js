import { createHash, randomUUID } from "node:crypto";
import {
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  fsyncSync,
  renameSync,
  unlinkSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { sessionKey } from "./session-store.js";
import { safePolishTrace } from "./polish-trace.js";

const identityKeys = ["artifact", "instance", "session", "epoch", "id", "digest", "attempt"];
const sameIdentity = (a, b) => !!a && !!b && identityKeys.every((key) => a[key] === b[key]);

// Runs inside the existing Pi instance. No model client, child agent, or replacement conversation.
export async function createPiHost(pi, ctx, directory, { trace = (_stage, _metadata) => {} } = {}) {
  trace = safePolishTrace(trace);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(directory, "host.lock"),
    file = path.join(directory, "host.json");
  const session = ctx.sessionManager.getSessionId();
  if (existsSync(lockPath)) {
    const previous = JSON.parse(readFileSync(lockPath, "utf8"));
    if (previous.session !== session || !Number.isSafeInteger(previous.pid) || previous.pid < 1)
      throw new Error("HOST_LOCK_INVALID");
    let alive = true;
    try {
      process.kill(previous.pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") alive = false;
    }
    if (alive) throw new Error("PI_REVIEW_ALREADY_OWNED");
    unlinkSync(lockPath);
  }
  const lock = openSync(lockPath, "wx", 0o600);
  writeFileSync(lock, JSON.stringify({ pid: process.pid, session }));
  fsyncSync(lock);
  let data = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : { instance: randomUUID(), session, messages: [] };
  if (data.session !== session) {
    closeSync(lock);
    unlinkSync(lockPath);
    throw new Error("SESSION_MISMATCH");
  }
  const interruptedClaims = data.messages.filter((m) => m.state === "processing" && !m.reply).map((m) => m.claim);
  let active,
    firstToken = false,
    modelStarted = false,
    stopped = false,
    poisoned = false,
    receive = async (_key, _proof) => {};
  const report = (error) => ctx.ui?.notify?.(`Polish: ${error.message}`, "error");
  const history = () => ctx.sessionManager.getBranch();
  function assertSession() {
    if (ctx.sessionManager.getSessionId() !== session) throw new Error("SESSION_MISMATCH");
  }
  function change(update) {
    if (stopped || poisoned) throw new Error("HOST_CLOSED");
    const next = structuredClone(data);
    update(next);
    const temp = path.join(directory, `${randomUUID()}.tmp`);
    try {
      const fd = openSync(temp, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify(next));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temp, file);
      const dir = openSync(directory, "r");
      try {
        fsyncSync(dir);
      } finally {
        closeSync(dir);
      }
      data = next;
    } catch (error) {
      poisoned = true;
      throw error;
    }
  }
  if (!existsSync(file)) change(() => {});
  function proof(record) {
    assertSession();
    if (!record) return null;
    const claim = record.claim;
    if (record.state === "accepted") return { ...claim, kind: "queued", evidenceId: record.admissionId };
    const entries = history();
    const input = entries.filter(
      (e) => e.type === "custom_message" && e.customType === "polish-input" && sameIdentity(e.details, claim),
    );
    if (!record.inputEntryId || input.length !== 1 || input[0].id !== record.inputEntryId) return null;
    const consumed = {
      ...claim,
      kind: "consumed",
      evidenceId: record.inputEntryId,
      inputEvidence: "context_with_system",
    };
    // Pi may retry a failed provider request itself. A later verified success must also repair
    // ledgers from older builds that retained both the previous failure and the final reply.
    const reply =
      record.reply &&
      entries.find((e) => e.id === record.reply.entryId && e.type === "message" && e.message?.role === "assistant");
    if (
      reply &&
      entries.indexOf(reply) > entries.indexOf(input[0]) &&
      reply.message.stopReason === "stop" &&
      reply.message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("") === record.reply.text
    ) {
      return {
        ...consumed,
        kind: "reply",
        evidenceId: reply.id,
        replyTo: claim.id,
        comment_id: record.prompt.comment_id,
        round_id: record.prompt.round_id,
        text: record.reply.text,
      };
    }
    if (record.failure) {
      const failed = entries.find(
        (e) =>
          e.id === record.failure.entryId &&
          e.type === "message" &&
          e.message?.role === "assistant" &&
          ["error", "aborted"].includes(e.message.stopReason),
      );
      if (failed && entries.indexOf(failed) > entries.indexOf(input[0]))
        return { ...consumed, kind: "failed", evidenceId: failed.id, error: record.failure.error };
    }
    return {
      ...consumed,
      ...(interruptedClaims.some((claim) => sameIdentity(claim, record.claim)) ? { executionUnknown: true } : {}),
    };
  }
  async function pump() {
    if (stopped || poisoned || active || !ctx.isIdle() || ctx.hasPendingMessages()) return;
    assertSession();
    const record = data.messages.find((m) => m.state === "accepted");
    if (!record) return;
    change((next) => {
      next.messages.find((m) => sameIdentity(m.claim, record.claim)).state = "dispatching";
    });
    active = record.claim;
    firstToken = false;
    modelStarted = false;
    trace("host_dispatching", { ...active });
    try {
      await pi.sendMessage(
        {
          customType: "polish-input",
          display: true,
          details: record.claim,
          content:
            record.kind === "end"
              ? `HTML review communication ended for ${record.claim.artifact}. All prior accepted feedback was delivered. Do not reopen without the user requesting it.`
              : `The user submitted HTML review feedback for ${record.claim.artifact}. This is the current session. Apply the requested revision to that file when appropriate, then explain the result. Your final response is associated with this exact submission automatically.\n\n${record.text}`,
        },
        { triggerTurn: true, deliverAs: "followUp" },
      );
    } catch (error) {
      await receive(sessionKey(record.claim.artifact), { ...record.claim, kind: "unknown" });
      report(error);
    }
  }
  const schedule = () =>
    setImmediate(async () => {
      try {
        await pump();
      } catch (error) {
        report(error);
      }
    });
  const unsubscribe = [
    pi.on("context_with_system", async (event) => {
      if (!active || stopped) return;
      assertSession();
      const inputs = event.messages.filter(
        (m) => m.role === "custom" && m.customType === "polish-input" && sameIdentity(m.details, active),
      );
      const entries = history().filter(
        (e) => e.type === "custom_message" && e.customType === "polish-input" && sameIdentity(e.details, active),
      );
      if (inputs.length !== 1 || entries.length !== 1) throw new Error("POLISH_INPUT_IDENTITY");
      change((next) => {
        const m = next.messages.find((m) => sameIdentity(m.claim, active));
        m.state = "processing";
        m.inputEntryId = entries[0].id;
        delete m.failure;
      });
      const record = data.messages.find((m) => sameIdentity(m.claim, active));
      trace("input_consumed", { ...active, evidence_id: entries[0].id });
      await receive(sessionKey(active.artifact), proof(record));
    }),
    pi.on("before_provider_request", () => {
      if (!active || stopped || modelStarted) return;
      modelStarted = true;
      trace("model_start", { ...active });
    }),
    pi.on("message_update", (event) => {
      if (!active || stopped || firstToken || event.assistantMessageEvent?.type !== "text_delta") return;
      firstToken = true;
      trace("first_token", { ...active });
    }),
    pi.on("turn_end", async (event) => {
      if (!active || stopped || event.message.role !== "assistant") return;
      assertSession();
      if (["error", "aborted"].includes(event.message.stopReason)) {
        change((next) => {
          const m = next.messages.find((m) => sameIdentity(m.claim, active));
          if (!m.inputEntryId) throw new Error("FAILURE_WITHOUT_INPUT");
          m.state = "failed";
          m.failure = {
            entryId: event.messageEntryId,
            error: event.message.errorMessage || `Pi ${event.message.stopReason}`,
          };
        });
        await receive(sessionKey(active.artifact), proof(data.messages.find((m) => sameIdentity(m.claim, active))));
        return;
      }
      if (event.message.stopReason !== "stop") return;
      const text = event.message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      change((next) => {
        const m = next.messages.find((m) => sameIdentity(m.claim, active));
        if (!m.inputEntryId) throw new Error("REPLY_WITHOUT_INPUT");
        m.state = "replied";
        m.reply = { entryId: event.messageEntryId, text };
        delete m.failure;
      });
      trace("host_reply_persisted", { ...active, evidence_id: event.messageEntryId });
      await receive(sessionKey(active.artifact), proof(data.messages.find((m) => sameIdentity(m.claim, active))));
    }),
    pi.on("agent_settled", () => {
      active = undefined;
      schedule();
    }),
  ];
  return {
    instance: data.instance,
    session,
    assertDurableSession() {
      assertSession();
      let transcript, parent;
      try {
        const file = ctx.sessionManager.getSessionFile?.();
        if (!file) throw new Error("No persisted Pi session");
        transcript = openSync(file, "r");
        const header = JSON.parse(readFileSync(transcript, "utf8").split("\n", 1)[0]);
        if (header.type !== "session" || header.id !== session) throw new Error("Pi transcript identity mismatch");
        // Pi keeps an empty conversation in memory, including custom entries. Never fabricate
        // a user message or session file to make an unrestorable binding look durable.
        fsyncSync(transcript);
        parent = openSync(path.dirname(file), "r");
        fsyncSync(parent);
      } catch {
        throw Object.assign(
          new Error("PI_SESSION_NOT_DURABLE: 请先在当前 Pi 会话开始一条实际对话，再打开 HTML 评审。"),
          { statusCode: 409 },
        );
      } finally {
        if (transcript !== undefined) closeSync(transcript);
        if (parent !== undefined) closeSync(parent);
      }
    },
    get port() {
      return data.port || 0;
    },
    setPort(port) {
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("INVALID_PORT");
      if (data.port !== port)
        change((next) => {
          next.port = port;
        });
    },
    setReceiver(fn) {
      receive = fn;
    },
    async deliver(message, claim) {
      assertSession();
      if (
        claim.instance !== data.instance ||
        claim.session !== session ||
        !claim.id ||
        !claim.attempt ||
        createHash("sha256").update(message.text).digest("hex") !== claim.digest
      )
        throw new Error("IDENTITY");
      const old = data.messages.find(
        (m) => m.claim.id === claim.id && m.claim.epoch === claim.epoch && m.claim.artifact === claim.artifact,
      );
      if (old && (!sameIdentity(old.claim, claim) || old.text !== message.text)) throw new Error("CONFLICT");
      if (!old) {
        change((next) =>
          next.messages.push({
            claim,
            text: message.text,
            prompt: message.prompt,
            kind: message.kind,
            admissionId: randomUUID(),
            state: "accepted",
          }),
        );
        trace("host_admitted", { ...claim });
      }
      const result = proof(old || data.messages.at(-1));
      if (!result) throw new Error("DELIVERY_UNKNOWN");
      schedule();
      return result;
    },
    async query(message) {
      return proof(data.messages.find((m) => sameIdentity(m.claim, message.claim)));
    },
    start() {
      schedule();
    },
    close() {
      if (stopped) return;
      stopped = true;
      unsubscribe.forEach((off) => off?.());
      closeSync(lock);
      unlinkSync(lockPath);
    },
  };
}
