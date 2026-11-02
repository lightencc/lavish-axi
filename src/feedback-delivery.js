import { createHash, randomUUID } from "node:crypto";

const digest = (text) => createHash("sha256").update(text).digest("hex");
const unsettled = (m) => ["dispatching", "host_queued", "unknown"].includes(m.state);
const identityKeys = ["artifact", "instance", "session", "epoch", "id", "digest", "attempt"];

// Canonical normalized prompt data, excluding transport-only image metadata and settlement ID.
export function feedbackText(prompt) {
  return JSON.stringify({
    uid: prompt.uid || "",
    prompt: prompt.prompt || "",
    selector: prompt.selector || "",
    tag: prompt.tag || "",
    text: prompt.text || "",
    ...(prompt.scope ? { scope: prompt.scope, comment_id: prompt.comment_id, round_id: prompt.round_id } : {}),
    ...(prompt.target ? { target: prompt.target } : {}),
    ...(prompt.attachments?.length ? { attachments: prompt.attachments.map(({ id, name }) => ({ id, name })) } : {}),
  });
}

export function bindFeedback(session, binding) {
  if (binding.artifact !== session.file || !binding.instance || !binding.session) throw new Error("BINDING");
  if (
    binding.inputEvidence &&
    !["context_with_system", "claude_channel_ack", "poll_response"].includes(binding.inputEvidence)
  )
    throw new Error("BINDING_EVIDENCE");
  if (session.review_delivery) {
    if (!["artifact", "instance", "session"].every((k) => session.review_delivery.binding[k] === binding[k]))
      throw new Error("BINDING");
    if (
      (session.review_delivery.binding.inputEvidence || "context_with_system") !==
      (binding.inputEvidence || "context_with_system")
    )
      throw new Error("BINDING_EVIDENCE");
    return;
  }
  if (session.prompts.length || session.chat.length || session.status === "ended")
    throw new Error("BIND_REQUIRES_EMPTY_OPEN_SESSION");
  session.review_delivery = {
    binding,
    epoch: 1,
    generation: 1,
    mode: binding.inputEvidence === "poll_response" ? "poll" : "bridge",
    version: 0,
    lifecycle: "open",
    messages: [],
    end: null,
  };
}

export function validateFeedback(session, prompts) {
  const d = session.review_delivery;
  if (!d) return;
  for (const p of prompts) {
    if (typeof p.prompt_id !== "string" || !p.prompt_id) throw new Error("MESSAGE_ID_REQUIRED");
    if (p.scope === "anchored" && (!p.selector || !p.text || !p.comment_id || !p.round_id))
      throw new Error("INVALID_ANCHOR");
    if (p.scope && !["anchored", "session"].includes(p.scope)) throw new Error("INVALID_SCOPE");
    if (p.round_id && d.messages.some((m) => m.id !== p.prompt_id && m.prompt.round_id === p.round_id))
      throw new Error("ROUND_CONFLICT");
    const old = d.messages.find((m) => m.id === p.prompt_id);
    if (old && old.digest !== digest(feedbackText(p))) throw new Error("CONFLICT");
    if (!old && d.lifecycle !== "open") throw new Error("CLOSED");
  }
}

export function appendFeedback(session, prompts, kind = "message") {
  const d = session.review_delivery;
  validateFeedback(session, prompts);
  for (const p of prompts) {
    if (d.messages.some((m) => m.id === p.prompt_id)) continue;
    const text = feedbackText(p);
    d.messages.push({
      id: p.prompt_id,
      epoch: d.epoch,
      text,
      digest: digest(text),
      prompt: p,
      kind,
      state: "accepted",
      consumed: false,
      resolved: false,
    });
  }
}

export function feedbackLease(session, mode) {
  const d = session?.review_delivery;
  if (!d) return null;
  if (d.mode !== mode) throw new Error("MODE");
  return { mode, generation: d.generation };
}

export function setFeedbackMode(session, mode) {
  const d = session.review_delivery;
  if (!["bridge", "poll"].includes(mode)) throw new Error("MODE");
  if (d.messages.some(unsettled)) throw new Error("UNSETTLED");
  d.mode = mode;
  d.generation++;
}

export function recoverFeedback(session) {
  const d = session.review_delivery;
  d.generation++;
  for (const m of d.messages) if (unsettled(m)) m.state = "unknown";
}

export function takeBoundFeedback(session, lease) {
  const d = session.review_delivery;
  if (!lease) throw new Error("LEASE_REQUIRED");
  if (lease.generation !== d.generation) throw new Error("STALE");
  if (lease.mode !== d.mode) throw new Error("MODE");
  if (
    d.lifecycle === "ended" &&
    !(d.binding.inputEvidence === "poll_response" && d.messages.some((m) => m.state === "accepted"))
  )
    return { status: "ended", ended_by: session.ended_by || "user" };
  if (d.messages.some(unsettled)) return { status: "waiting" };
  const m = d.messages.find((m) => m.state === "accepted");
  if (!m) return { status: "waiting" };
  if (m.kind === "end" && d.messages.some((other) => other !== m && !other.consumed)) return { status: "waiting" };
  const token = {
    ...d.binding,
    epoch: d.epoch,
    generation: d.generation,
    mode: d.mode,
    id: m.id,
    digest: m.digest,
    attempt: randomUUID(),
  };
  m.state = "dispatching";
  m.claim = token;
  session.prompts = session.prompts.filter((p) => p.prompt_id !== m.id);
  session.pending_prompts = session.prompts.length;
  return { status: "feedback", prompts: [m.prompt], dom_snapshot: session.dom_snapshot || "", delivery: token };
}

// Called only when the existing poll handler knows no response was written.
// Keep Lavish's restore semantics; other hosts still retain unknown deliveries.
export function restorePollFeedback(session, token) {
  const d = session.review_delivery;
  if (d.binding.inputEvidence !== "poll_response") throw new Error("MODE");
  const m = validateToken(session, token);
  if (m.reply) throw new Error("ALREADY_REPLIED");
  m.state = "accepted";
  m.consumed = false;
  delete m.claim;
  delete m.inputEvidence;
  if (d.end && d.lifecycle === "ended") {
    d.lifecycle = "ending";
    session.status = "open";
    session.ended_by = null;
  }
  if (!session.prompts.some((p) => p.prompt_id === m.id)) session.prompts.unshift(m.prompt);
  session.pending_prompts = session.prompts.length;
}

function validateToken(session, token) {
  const d = session.review_delivery;
  if (token.generation !== d.generation || token.mode !== d.mode) throw new Error("STALE");
  const m = d.messages.find((m) => m.id === token.id);
  if (!m?.claim || !identityKeys.every((k) => token[k] === m.claim[k])) throw new Error("IDENTITY");
  return m;
}

export function markFeedbackUnknown(session, token) {
  const m = validateToken(session, token);
  if (m.state === "replied") return;
  if (m.consumed) m.executionUnknown = true;
  else m.state = "unknown";
}

export function reserveFeedbackHost(session, token) {
  const m = validateToken(session, token);
  if (m.state !== "dispatching" || m.host_dispatched) throw new Error("HOST_ALREADY_DISPATCHED_OR_UNKNOWN");
  m.host_dispatched = true;
}

// Only a trusted in-process host adapter may call this. There is no browser receipt route.
export function reconcileFeedback(session, proof, token = null) {
  if (token) validateToken(session, token);
  const d = session.review_delivery;
  if (!token && proof.epoch !== d.epoch) {
    const previous = d.history?.find((entry) => entry.epoch === proof.epoch);
    if (
      proof.kind !== "reply" ||
      typeof proof.text !== "string" ||
      !previous ||
      previous.lifecycle !== "ended" ||
      !previous.messages.some((m) => m.id === proof.id && m.consumed)
    )
      throw new Error("EPOCH");
    reconcileFeedback({ ...session, review_delivery: previous }, proof);
    previous.version++;
    return false; // Historical reply persistence must not invalidate the active review version.
  }
  const m = d.messages.find((m) => m.id === proof.id);
  if (!m?.claim || !identityKeys.every((k) => proof[k] === m.claim[k]) || (token && token.id !== proof.id))
    throw new Error("IDENTITY");
  if (proof.kind === "reply" && proof.text !== undefined) {
    if (
      proof.replyTo !== m.id ||
      typeof proof.text !== "string" ||
      proof.comment_id !== m.prompt.comment_id ||
      proof.round_id !== m.prompt.round_id
    )
      throw new Error("REPLY_IDENTITY");
    if (m.reply && (m.reply.evidenceId !== proof.evidenceId || m.reply.text !== proof.text))
      throw new Error("REPLY_CONFLICT");
  }
  if (
    !["queued", "consumed", "reply", "failed"].includes(proof.kind) ||
    (proof.kind === "failed" && (typeof proof.error !== "string" || !proof.error)) ||
    !proof.evidenceId ||
    (proof.kind !== "queued" && proof.inputEvidence !== (d.binding.inputEvidence || "context_with_system"))
  )
    throw new Error("EVIDENCE");
  if (proof.kind === "queued" && !m.consumed) {
    m.state = "host_queued";
    m.queueEvidence = proof.evidenceId;
  }
  if (proof.kind !== "queued") {
    m.consumed = true;
    m.inputEvidence = proof.evidenceId;
    if (m.state !== "replied") m.state = "delivered";
  }
  if (proof.kind === "consumed" || proof.kind === "reply") {
    delete m.execution_error;
    m.executionUnknown = proof.executionUnknown === true;
  }
  if (proof.kind === "reply") {
    m.state = "replied";
    m.replyEvidence = proof.evidenceId;
    m.executionUnknown = false;
    if (proof.text !== undefined && !m.reply)
      m.reply = { text: proof.text, version: 1, evidenceId: proof.evidenceId, reply_to: m.id };
  }
  if (proof.kind === "failed" && !m.reply) {
    m.state = "failed";
    m.execution_error = proof.error;
  }
  if (proof.kind === "consumed" && proof.executionUnknown === true && !m.reply) m.executionUnknown = true;
  if (d.lifecycle === "ending" && d.end.ids.every((id) => d.messages.find((m) => m.id === id).consumed)) {
    d.lifecycle = "ended";
    session.status = "ended";
    session.ended_by = "user";
  }
}

export function completeFeedback(session, request) {
  const d = session.review_delivery;
  if (request.epoch !== d.epoch) throw new Error("EPOCH");
  if (d.lifecycle !== "open") throw new Error("CLOSED");
  const m = d.messages.findLast((entry) =>
    request.comment_id ? entry.prompt.comment_id === request.comment_id : entry.id === request.message_id,
  );
  if (!m || m.prompt.round_id !== request.round_id) throw new Error("STALE_ROUND");
  if (!m.reply || m.reply.version !== request.reply_version) throw new Error("STALE_REPLY");
  if (request.artifact_revision !== session.artifact_revision) throw new Error("STALE_REVISION");
  m.resolved = true;
}

export function reopenFeedback(session, binding) {
  const d = session.review_delivery;
  if (!["artifact", "instance", "session"].every((key) => d.binding[key] === binding[key])) throw new Error("BINDING");
  if (d.lifecycle !== "ended") throw new Error("REOPEN_REQUIRES_ENDED");
  const { history = [], ...previous } = d;
  d.history = [...history, previous];
  d.epoch++;
  d.generation++;
  d.messages = [];
  d.end = null;
  d.lifecycle = "open";
  session.status = "open";
  session.ended_by = null;
  session.prompts = [];
  session.pending_prompts = 0;
}

export function beginFeedbackEnd(session, request) {
  const d = session.review_delivery;
  if (typeof request.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(request.id)) throw new Error("INVALID_END_ID");
  if (request.epoch !== d.epoch || (request.final && request.final.epoch !== d.epoch)) throw new Error("EPOCH");
  const hash = digest(
    JSON.stringify({
      id: request.id,
      epoch: request.epoch,
      final: request.final ? { id: request.final.id, text: request.final.text, epoch: request.final.epoch } : null,
    }),
  );
  if (d.end) {
    if (d.end.id !== request.id || d.end.digest !== hash) throw new Error("CONFLICT");
    return;
  }
  if (d.lifecycle !== "open") throw new Error("CLOSED");
  const prompts = [];
  if (request.final) prompts.push({ prompt_id: request.final.id, prompt: request.final.text });
  const marker = { prompt_id: request.id + "-marker", prompt: "Review ended: " + request.id };
  if (d.messages.some((m) => m.id === marker.prompt_id)) throw new Error("CONFLICT");
  appendFeedback(session, prompts);
  appendFeedback(session, [marker], "end");
  session.prompts.push(...prompts.filter((p) => !session.prompts.some((old) => old.prompt_id === p.prompt_id)), marker);
  session.pending_prompts = session.prompts.length;
  d.end = { id: request.id, digest: hash, ids: d.messages.map((m) => m.id) };
  d.lifecycle = "ending";
}
