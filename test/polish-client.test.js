import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const source = await readFile(new URL("../src/polish-client.js", import.meta.url), "utf8");
const flush = () => new Promise((resolve) => setImmediate(resolve));

// Execute the production mount. Only DOM/storage/fetch/window boundaries are fake.
async function fixture({
  rejectFirstSend = false,
  loseFirstSend = false,
  loseFirstEnd = false,
  immediateEnd = false,
  savedStorage = new Map(),
} = {}) {
  const elements = new Map(),
    documentListeners = new Map(),
    storage = new Map(savedStorage),
    requests = [],
    frameMessages = [];
  let windowCloses = 0,
    reloads = 0,
    sendAttempts = 0,
    endAttempts = 0;
  let state = {
    epoch: 1,
    version: 1,
    lifecycle: "open",
    messages: [],
    artifact_revision: 1,
    artifact_load_token: "loaded-artifact",
    artifact_digest: "a".repeat(64),
  };
  class Element {
    constructor(tag = "div") {
      this.tagName = tag;
      this.value = "";
      this.textContent = "";
      this.hidden = false;
      this.disabled = false;
      this.checked = false;
      this.style = {};
      this.children = [];
      this.parent = null;
      this.onclick = null;
      this.oninput = null;
      this.onchange = null;
      this.listeners = new Map();
      this.classes = new Set();
      this.classList = {
        toggle: (name, enabled) => {
          if (enabled) this.classes.add(name);
          else this.classes.delete(name);
        },
      };
    }
    set id(value) {
      this.elementId = value;
      elements.set(value, this);
    }
    get id() {
      return this.elementId;
    }
    set innerHTML(html) {
      this.children = [];
      for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)) {
        const child = new Element(match[1]);
        child.id = match[2];
        this.appendChild(child);
      }
    }
    setAttribute() {}
    insertBefore(child, reference = null) {
      if (child.parent) child.parent.removeChild(child);
      const index = reference ? this.children.indexOf(reference) : this.children.length;
      this.children.splice(index, 0, child);
      child.parent = this;
      return child;
    }
    removeChild(child) {
      this.children.splice(this.children.indexOf(child), 1);
      child.parent = null;
      return child;
    }
    appendChild(child) {
      child.parent = this;
      this.children.push(child);
      return child;
    }
    replaceChildren() {
      this.children = [];
    }
    contains(target) {
      return target === this || this.children.some((child) => child.contains(target));
    }
    addEventListener(name, handler) {
      this.listeners.set(name, handler);
    }
    getBoundingClientRect() {
      return { left: 100, top: 100, width: 360, height: 300 };
    }
    focus() {}
    click() {
      if (!this.disabled) return this.onclick?.({ target: this });
    }
  }
  const bar = new Element(),
    body = new Element(),
    more = new Element();
  more.id = "moreWrap";
  const fetch = async (url, options) => {
    const data = options?.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, method: options?.method || "GET", data });
    const reply = (status, value) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => structuredClone(value),
    });
    if (url.endsWith("/prompts")) {
      sendAttempts++;
      if (loseFirstSend && sendAttempts === 1) throw new Error("SEND_RESULT_UNKNOWN");
      if (rejectFirstSend && sendAttempts === 1) return reply(422, { error: "DEFINITELY_REJECTED" });
      const p = data.prompts[0];
      state = {
        ...state,
        version: state.version + 1,
        messages: [...state.messages, { id: p.prompt_id, prompt: p, state: "accepted", resolved: false }],
      };
      return reply(200, { status: "queued" });
    }
    if (url.endsWith("/review/end")) {
      endAttempts++;
      if (loseFirstEnd && endAttempts === 1) throw new Error("END_RESULT_UNKNOWN");
      state = {
        ...state,
        version: state.version + 1,
        lifecycle: immediateEnd ? "ended" : "ending",
        end: { id: data.id },
      };
      return reply(200, state);
    }
    if (url.endsWith("/review/complete")) {
      state = {
        ...state,
        version: state.version + 1,
        messages: state.messages.map((m) => (m.id === data.message_id ? { ...m, resolved: true } : m)),
      };
      return reply(200, state);
    }
    if (url.endsWith("/review") && !options?.method) return reply(200, state);
    throw new Error(`Unexpected test request: ${url}`);
  };
  const window = {
    innerWidth: 1200,
    innerHeight: 900,
    addEventListener() {},
    close() {
      windowCloses++;
    },
  };
  const context = vm.createContext({
    window,
    document: {
      body,
      getElementById: (id) => elements.get(id),
      querySelector: (selector) => (selector === ".bar" ? bar : null),
      createElement: (tag) => new Element(tag),
      addEventListener(name, handler) {
        documentListeners.set(name, handler);
      },
    },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    crypto: { randomUUID },
    fetch,
  });
  new vm.Script(source, { filename: "actual-polish-client.js" }).runInContext(context);
  const client = context.window.mountPolishReview({
    key: "isolated-client",
    frame: new Element("iframe"),
    post: (message) => frameMessages.push(message),
    reload: async () => {
      reloads++;
    },
    currentLoad: () => ({ token: "loaded-artifact" }),
  });
  await flush();
  const get = (id) => {
    const element = elements.get(id);
    assert.ok(element, `mounted control ${id}`);
    return element;
  };
  return {
    client,
    get,
    requests,
    frameMessages,
    storage,
    dispatch(name, event) {
      documentListeners.get(name)?.(event);
    },
    sync(update) {
      state = { ...state, ...update };
      client.sync(structuredClone(state));
    },
    closes: () => windowCloses,
    reloads: () => reloads,
    writes: (route) => requests.filter((r) => r.method === "POST" && r.url.endsWith(route)),
    openOverall() {
      get("polish-overall").click();
    },
    type(text) {
      const input = get("polish-input");
      input.value = text;
      input.oninput();
    },
    async viewArtifact() {
      client.handleFrame({ type: "polish:ready" });
      await flush();
    },
  };
}

test("overall draft survives closing and reopening the overall dialog", async () => {
  const f = await fixture();
  f.openOverall();
  f.type("Keep this unsent overall feedback");
  f.get("polish-close").click();
  assert.equal(f.get("polish-dialog").hidden, true);
  f.openOverall();
  assert.equal(f.get("polish-input").value, "Keep this unsent overall feedback");
  assert.equal(f.writes("/prompts").length, 0, "draft restoration must not send a message");
});

test("explicit reopen recovers the previous epoch unsent draft without sending or erasing its archive", async () => {
  const f = await fixture();
  f.openOverall();
  f.type("Unsent feedback from the previous review");
  f.get("polish-close").click();
  const oldKey = "polish:drafts:isolated-client:1";
  const archived = f.storage.get(oldKey);
  assert.ok(archived.includes("Unsent feedback from the previous review"));
  f.sync({ version: 2, lifecycle: "ended" });
  // Only an explicit server-side reopen may produce this next epoch snapshot.
  f.sync({ epoch: 2, version: 3, lifecycle: "open", messages: [] });
  f.openOverall();
  assert.equal(f.get("polish-input").value, "Unsent feedback from the previous review");
  assert.equal(f.storage.get(oldKey), archived, "the previous epoch remains recoverable in storage");
  assert.equal(f.requests.filter((r) => r.method === "POST").length, 0, "restoration must not send old feedback");
});

test("requestEnd with an unsent draft offers a choice and cancel preserves it without sending", async () => {
  const f = await fixture();
  f.openOverall();
  f.type("Unsent manual-end feedback");
  await f.client.requestEnd();
  assert.equal(f.requests.filter((r) => r.method === "POST").length, 0);
  assert.equal(f.get("polish-end-cancel").hidden, false);
  await f.get("polish-end-cancel").click();
  assert.equal(f.get("polish-input").value, "Unsent manual-end feedback");
  assert.equal(f.requests.filter((r) => r.method === "POST").length, 0);
});

test("manual end keep choice archives the unsent draft and ends with final null", async () => {
  const f = await fixture();
  f.openOverall();
  f.type("Keep locally instead of sending this draft");
  await f.client.requestEnd();
  assert.equal(f.requests.filter((r) => r.method === "POST").length, 0);
  await f.get("polish-end-keep").click();
  await flush();
  const attempts = f.writes("/review/end");
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].data.final, null);
  assert.equal(f.writes("/prompts").length, 0);
  assert.ok(f.storage.get("polish:drafts:isolated-client:1").includes("Keep locally instead of sending this draft"));
});

test("manual end send choice includes the current draft in the single final batch", async () => {
  const f = await fixture();
  f.openOverall();
  f.type("Send this exact final feedback");
  await f.client.requestEnd();
  assert.equal(f.requests.filter((r) => r.method === "POST").length, 0);
  await f.get("polish-end-send").click();
  await flush();
  const attempts = f.writes("/review/end");
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].data.final.text, "Send this exact final feedback");
  assert.equal(f.writes("/prompts").length, 0, "the final draft travels only in the sealed end batch");
});

test("explicit HTTP 4xx rejection retains editable text and lets the user retry", async () => {
  const f = await fixture({ rejectFirstSend: true });
  f.openOverall();
  f.type("Please revise the page");
  await f.get("polish-send").click();
  await flush();
  assert.equal(f.writes("/prompts").length, 1, "definitive rejection must not auto-resubmit");
  assert.equal(f.get("polish-input").value, "Please revise the page");
  assert.equal(f.get("polish-input").disabled, false);
  assert.match(f.get("polish-error").textContent, /DEFINITELY_REJECTED/);
  assert.equal(f.get("polish-send").disabled, false, "a definitive 4xx must not leave an unresolved-send gate");
  f.type("Please revise the page with this correction");
  await f.get("polish-send").click();
  await flush();
  assert.equal(f.writes("/prompts").length, 2);
  assert.equal(f.writes("/prompts")[1].data.prompts[0].prompt, "Please revise the page with this correction");
});

test("retrying an end request after transport uncertainty preserves end and final-message identity", async () => {
  const f = await fixture({ loseFirstEnd: true });
  f.openOverall();
  f.type("Final review feedback");
  await f.client.end("send");
  assert.equal(f.writes("/review/end").length, 1);
  assert.match(f.get("polish-error").textContent, /END_RESULT_UNKNOWN/);
  assert.equal(f.get("polish-input").value, "Final review feedback");
  await f.client.end("send");
  const attempts = f.writes("/review/end");
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].data.id, attempts[0].data.id, "retry must query/reuse the original end identity");
  assert.equal(attempts[1].data.final.id, attempts[0].data.final.id, "the fixed final message must keep its identity");
  assert.deepEqual(attempts[1].data, attempts[0].data, "uncertain end retry must preserve the original sealed request");
});

test("confirm-and-end closes the page when its HTTP response already contains ended", async () => {
  const f = await fixture({ immediateEnd: true });
  await f.viewArtifact();
  await f.client.end("confirm");
  const request = f.writes("/review/end");
  assert.equal(request.length, 1);
  assert.equal(request[0].data.confirm, true);
  assert.equal(f.closes(), 1, "synchronous ended must satisfy close-after-confirm without waiting for another event");
  assert.match(f.get("polish-status").textContent, /通信已结束/);
});

test("transport-unknown send preserves its draft and never resubmits during refresh or reopen", async () => {
  const f = await fixture({ loseFirstSend: true });
  f.openOverall();
  f.type("Keep this feedback until receipt is known");
  await f.get("polish-send").click();
  await flush();
  assert.match(f.get("polish-error").textContent, /SEND_RESULT_UNKNOWN/);
  assert.equal(f.get("polish-input").value, "Keep this feedback until receipt is known");
  assert.equal(f.get("polish-send").disabled, true);
  await f.viewArtifact();
  f.get("polish-close").click();
  f.openOverall();
  assert.equal(f.get("polish-input").value, "Keep this feedback until receipt is known");
  await f.get("polish-send").click();
  await flush();
  assert.equal(f.writes("/prompts").length, 1, "uncertain transport must not create another delivery");
  assert.equal(f.get("polish-send").disabled, true);
});

test("overall send excludes element fields and publishes no artifact pin even after anchored selection", async () => {
  const f = await fixture();
  f.client.handleFrame({
    type: "polish:open",
    context: { selector: "#alpha", text: "Alpha paragraph", tag: "p", target: { kind: "text" } },
    x: 100,
    y: 120,
  });
  f.openOverall();
  f.type("Revise the overall layout");
  await f.get("polish-send").click();
  await flush();
  const writes = f.writes("/prompts");
  assert.equal(writes.length, 1);
  const prompt = writes[0].data.prompts[0];
  assert.equal(prompt.scope, "session");
  for (const field of ["selector", "text", "quote", "block", "tag", "target"]) {
    assert.equal(Object.hasOwn(prompt, field), false, `overall message must omit ${field}`);
  }
  const pinStates = f.frameMessages.filter((m) => m.type === "polish:state");
  assert.ok(pinStates.length > 0, "actual mount must publish artifact state");
  assert.ok(
    pinStates.every((m) => m.items.length === 0),
    "overall feedback must never request a pin",
  );
});

test("accepted send-and-end retires only the sent draft before explicit reopen", async () => {
  const f = await fixture();
  f.openOverall();
  f.type("This final feedback is now sent");
  await f.client.end("send");
  const saved = JSON.parse(f.storage.get("polish:drafts:isolated-client:1"));
  assert.ok(
    Object.values(saved.drafts).every((d) => !d.draft),
    "accepted final feedback is not an unsent draft",
  );
});

test("verified failure removes processing status and shows the failure in discussion history", async () => {
  const f = await fixture();
  f.sync({
    version: 2,
    messages: [
      {
        id: "failed-message",
        state: "failed",
        consumed: true,
        execution_error: "Provider unavailable",
        prompt: { scope: "session", prompt: "Revise", comment_id: "failure-thread" },
      },
    ],
  });
  f.openOverall();
  assert.match(f.get("polish-status").textContent, /处理失败/);
  assert.equal(f.get("polish-status").classes.has("processing"), false);
  f.get("polish-threads").onchange({ target: { value: "failure-thread" } });
  assert.match(f.get("polish-message-status").textContent, /Provider unavailable/);
  assert.equal(f.get("polish-complete").disabled, true);
});

test("missing anchor remains in overall history with an explicit position-changed label", async () => {
  const f = await fixture();
  f.sync({
    version: 2,
    messages: [
      {
        id: "m1",
        state: "replied",
        prompt: { scope: "anchored", comment_id: "c1", selector: "#gone", text: "Original", prompt: "Revise this" },
      },
    ],
  });
  f.client.handleFrame({ type: "polish:anchors", missing: ["c1"] });
  f.openOverall();
  const option = f.get("polish-threads").children.find((item) => item.value === "c1");
  assert.match(option.textContent, /原内容位置已变化/);
  f.get("polish-threads").value = "c1";
  f.get("polish-threads").onchange({ target: f.get("polish-threads") });
  assert.match(f.get("polish-message-status").textContent, /原内容位置已变化/);
  assert.equal(f.get("polish-history").children[0].textContent, "你\nRevise this");
  const posts = f.frameMessages.length;
  f.client.handleFrame({ type: "polish:anchors", missing: ["c1"] });
  assert.equal(f.frameMessages.length, posts, "unchanged anchor reports must not create a render/post loop");
  f.client.handleFrame({ type: "polish:anchors", missing: [] });
  assert.doesNotMatch(f.get("polish-message-status").textContent, /原内容位置已变化/);
});

test("only a started iframe selection forwards its outside pointer release", async () => {
  const f = await fixture();
  const event = { clientX: 150, clientY: 70 };
  f.dispatch("pointerup", event);
  assert.equal(
    f.frameMessages.some((m) => m.type === "polish:selectionEnd"),
    false,
  );
  f.client.handleFrame({ type: "polish:selectionStart" });
  f.dispatch("pointerup", event);
  const ends = f.frameMessages.filter((m) => m.type === "polish:selectionEnd");
  assert.equal(ends.length, 1);
  assert.equal(ends[0].x, 50);
  assert.equal(ends[0].y, -30);
  f.dispatch("pointerup", event);
  f.client.handleFrame({ type: "polish:selectionStart" });
  f.client.handleFrame({ type: "polish:selectionDone" });
  f.dispatch("pointerup", event);
  assert.equal(f.frameMessages.filter((m) => m.type === "polish:selectionEnd").length, 1);
});

test("modifier comment shortcut opens overall feedback without an anchor and ignores IME", async () => {
  const f = await fixture();
  const event = { ctrlKey: true, altKey: true, key: "m", isComposing: true, preventDefault() {} };
  f.dispatch("keydown", event);
  assert.equal(f.get("polish-dialog").hidden, true);
  f.dispatch("keydown", { ...event, isComposing: false });
  assert.equal(f.get("polish-dialog").hidden, false);
  assert.equal(f.get("polish-quote").hidden, true);
});

test("consumed execution with unknown result stops orange processing without inventing failure", async () => {
  const f = await fixture();
  f.sync({
    version: 2,
    messages: [
      {
        id: "uncertain",
        state: "delivered",
        consumed: true,
        executionUnknown: true,
        prompt: {
          scope: "anchored",
          comment_id: "uncertain-comment",
          selector: "#original",
          text: "Original",
          prompt: "Revise this",
        },
      },
    ],
  });
  assert.equal(f.get("polish-status").textContent, "处理已中断，结果待核实，请勿重复发送");
  assert.equal(f.get("polish-status").classes.has("processing"), false);
  assert.equal(f.frameMessages.findLast((m) => m.type === "polish:state").items[0].state, "unknown");
  f.client.handleFrame({ type: "polish:openThread", id: "uncertain-comment", x: 20, y: 20 });
  assert.equal(f.get("polish-message-status").textContent, "处理已中断，结果待核实，请勿重复发送");
  f.sync({
    version: 3,
    messages: [
      {
        id: "uncertain",
        state: "replied",
        consumed: true,
        executionUnknown: false,
        reply: { text: "Recovered reply" },
        prompt: {
          scope: "anchored",
          comment_id: "uncertain-comment",
          selector: "#original",
          text: "Original",
          prompt: "Revise this",
        },
      },
    ],
  });
  assert.doesNotMatch(f.get("polish-status").textContent, /处理中断|待核实/);
  assert.equal(f.frameMessages.findLast((m) => m.type === "polish:state").items[0].state, "replied");
});

test("opening an iframe selection keeps its fresh highlight until the comment is closed", async () => {
  const f = await fixture();
  const before = f.frameMessages.filter((m) => m.type === "polish:close").length;
  f.client.handleFrame({ type: "polish:open", context: { selector: "#original", text: "Original" }, x: 20, y: 20 });
  assert.equal(f.frameMessages.filter((m) => m.type === "polish:close").length, before);
  f.get("polish-close").click();
  assert.equal(f.frameMessages.filter((m) => m.type === "polish:close").length, before + 1);
});

test("historical failure or interrupted execution cannot hide a newer reply notification", async () => {
  for (const old of [
    { state: "failed", consumed: false, execution_error: "Dispatch rejected" },
    { state: "failed", consumed: true, execution_error: "Provider failure" },
    { state: "delivered", consumed: true, executionUnknown: true },
  ]) {
    const f = await fixture();
    const failed = {
      id: "old-error",
      ...old,
      prompt: { scope: "session", comment_id: "old-comment", prompt: "Old feedback" },
    };
    const replied = {
      id: "new-reply",
      state: "replied",
      consumed: true,
      reply: { text: "New reply" },
      prompt: { scope: "session", comment_id: "new-comment", prompt: "New feedback" },
    };
    f.sync({ version: 2, messages: [failed, replied] });
    assert.equal(f.get("polish-status").textContent, "回复已更新 · 打开讨论查看");
    f.client.handleFrame({ type: "polish:openThread", id: "old-comment", x: 20, y: 20 });
    assert.match(f.get("polish-message-status").textContent, old.executionUnknown ? /处理已中断/ : /处理失败/);
    const current = {
      id: "current",
      state: "delivered",
      consumed: true,
      prompt: { scope: "session", prompt: "Current feedback" },
    };
    f.sync({ version: 3, messages: [failed, replied, current] });
    assert.equal(f.get("polish-status").textContent, "agent 正在处理");
    f.sync({ version: 4, messages: [failed, replied, { ...current, state: "host_queued", consumed: false }] });
    assert.equal(f.get("polish-status").textContent, "agent 正忙，已排队");
  }
});

test("unknown submission remains visibly uncertain after refresh and a fresh mount", async () => {
  const f = await fixture({ loseFirstSend: true });
  f.openOverall();
  f.type("Preserve the original uncertain identity");
  await f.get("polish-send").click();
  await f.viewArtifact();
  const restored = await fixture({ savedStorage: f.storage });
  restored.openOverall();
  for (const page of [f, restored]) {
    assert.match(page.get("polish-status").textContent, /发送结果待核实/);
    assert.match(page.get("polish-message-status").textContent, /请勿重复发送/);
    assert.doesNotMatch(page.get("polish-message-status").textContent, /尚未发送/);
    assert.equal(page.get("polish-send").disabled, true);
    assert.equal(page.get("polish-input").value, "Preserve the original uncertain identity");
  }
  assert.deepEqual([...restored.storage], [...f.storage]);
  assert.equal(restored.writes("/prompts").length, 0);
});

test("anchored review sends once, collapses to a pin, follows up in place and completes only by the user", async () => {
  const f = await fixture();
  const pins = () => f.frameMessages.filter((m) => m.type === "polish:state").at(-1).items;
  f.client.handleFrame({
    type: "polish:open",
    context: { selector: "#synthetic", text: "Synthetic paragraph", tag: "p" },
    x: 120,
    y: 140,
  });
  assert.equal(f.get("polish-dialog").hidden, false);
  f.type("Clarify this synthetic paragraph");
  await f.get("polish-send").click();
  assert.equal(f.writes("/prompts").length, 1, "one click sends without a sidebar step");
  assert.equal(f.get("polish-dialog").hidden, true, "accepted send collapses the floating editor");
  assert.equal(pins().length, 1);
  const first = f.writes("/prompts")[0].data.prompts[0];
  const delivered = { id: first.prompt_id, prompt: first, state: "delivered", resolved: false };
  f.sync({ version: 3, messages: [delivered] });
  assert.equal(pins()[0].state, "delivered");
  const replied = { ...delivered, reply: { text: "Synthetic reply", version: 4 } };
  f.sync({ version: 4, messages: [replied] });
  assert.equal(pins().length, 1, "an agent reply never completes the comment");
  assert.equal(f.reloads(), 0, "reply notification does not reload HTML");
  assert.equal(f.writes("/review/complete").length, 0);
  f.client.handleFrame({ type: "polish:openThread", id: first.comment_id, x: 120, y: 140 });
  assert.equal(f.get("polish-dialog").hidden, false);
  await f.get("polish-refresh").click();
  assert.equal(f.reloads(), 1, "only an explicit refresh loads new HTML");
  await f.viewArtifact();
  f.type("A synthetic follow-up");
  await f.get("polish-send").click();
  const second = f.writes("/prompts")[1].data.prompts[0];
  assert.equal(second.comment_id, first.comment_id);
  assert.notEqual(second.round_id, first.round_id);
  assert.equal(pins().length, 1, "one discussion has one pin across rounds");
  f.sync({
    version: 6,
    messages: [
      replied,
      {
        id: second.prompt_id,
        prompt: second,
        state: "delivered",
        resolved: false,
        reply: { text: "Synthetic second reply", version: 6 },
      },
    ],
  });
  f.client.handleFrame({ type: "polish:openThread", id: second.comment_id, x: 120, y: 140 });
  await f.viewArtifact();
  f.get("polish-complete").checked = true;
  await f.get("polish-complete").onchange();
  assert.equal(f.writes("/review/complete").length, 1);
  assert.equal(pins().length, 0, "explicit user completion removes the pin");
  assert.equal(f.get("polish-dialog").hidden, true);
});

test("live replies update open and collapsed threads without reload, preserve drafts and stable history", async () => {
  const f = await fixture();
  await f.viewArtifact();
  const message = {
    id: "live",
    state: "delivered",
    consumed: true,
    prompt: {
      scope: "anchored",
      comment_id: "thread",
      round_id: "round",
      selector: "#synthetic",
      text: "Synthetic",
      prompt: "Review this",
    },
  };
  f.sync({ version: 2, messages: [message] });
  f.client.handleFrame({ type: "polish:openThread", id: "thread", x: 20, y: 20 });
  f.type("Unsent follow-up");
  const history = f.get("polish-history"),
    original = history.children[0];
  history.scrollTop = 17;
  const replied = { ...message, state: "replied", reply: { text: "Automatic reply", version: 3 } };
  f.sync({ version: 3, messages: [replied] });
  assert.equal(history.children[1]?.textContent, "agent\nAutomatic reply");
  assert.equal(history.children[0], original, "keep existing text nodes and selection");
  assert.equal(history.scrollTop, 17);
  assert.equal(f.get("polish-input").value, "Unsent follow-up");
  assert.equal(f.get("polish-complete").disabled, true, "draft still prevents completion");
  const agent = history.children[1];
  f.sync({ version: 3, messages: [replied] });
  assert.equal(history.children.length, 2);
  assert.equal(history.children[1], agent, "duplicate state does not replace nodes");
  f.get("polish-close").click();
  f.client.disconnected();
  f.sync({ version: 4, messages: [{ ...replied, reply: { text: "Recovered automatic reply", version: 4 } }] });
  assert.equal(f.get("polish-dialog").hidden, true, "reconnect must not open a collapsed comment");
  f.client.handleFrame({ type: "polish:openThread", id: "thread", x: 20, y: 20 });
  assert.equal(history.children[1].textContent, "agent\nRecovered automatic reply");
  assert.equal(f.get("polish-input").value, "Unsent follow-up");
  assert.equal(f.reloads(), 0);
  assert.equal(f.writes("/review/complete").length, 0);
  f.type("");
  assert.equal(f.get("polish-complete").disabled, false);
  f.get("polish-complete").checked = true;
  await f.get("polish-complete").onchange();
  assert.equal(f.writes("/review/complete")[0].data.reply_version, 4);
});

test("automatic reply display does not claim a changed HTML artifact was viewed", async () => {
  const f = await fixture();
  await f.viewArtifact();
  const message = {
    id: "changed",
    state: "replied",
    consumed: true,
    prompt: { scope: "session", comment_id: "changed-thread", prompt: "Review" },
    reply: { text: "Reply about newer HTML", version: 2 },
  };
  f.sync({
    version: 2,
    artifact_load_token: "different-artifact",
    artifact_digest: "b".repeat(64),
    messages: [message],
  });
  f.client.handleFrame({ type: "polish:openThread", id: "changed-thread" });
  assert.equal(f.get("polish-history").children[1]?.textContent, "agent\nReply about newer HTML");
  assert.equal(f.reloads(), 0);
  // The original loaded artifact proof is retained; the server still rejects stale HTML.
  f.get("polish-complete").checked = true;
  await f.get("polish-complete").onchange();
  assert.equal(f.writes("/review/complete")[0].data.artifact_load_token, "loaded-artifact");
});
