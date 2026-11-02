// Actual prototype scripts with DOM, HTTP and process boundaries replaced; no listener starts.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const pageSource = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const launcherSource = (await readFile(new URL("./polish", import.meta.url), "utf8"))
  .replace(/^#!.*\n/, "")
  .replace(/^import .*;\n/gm, "")
  .replaceAll("import.meta.url", "launcherUrl");
const flush = () => new Promise((resolve) => setImmediate(resolve));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

class Element {
  constructor(id = "", tag = "div", classes = "") {
    this.id = id;
    this.tag = tag;
    this.value = "";
    this.textContent = "";
    this.innerText = `${id} content`;
    this.hidden = id === "popover";
    this.disabled = false;
    this.checked = false;
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.elements = [];
    this.attributes = {};
    this.listeners = new Map();
    this.classes = new Set(classes.split(/\s+/));
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      toggle: (name, on) => {
        if (on ?? !this.classes.has(name)) this.classes.add(name);
        else this.classes.delete(name);
      },
    };
  }
  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }
  getBoundingClientRect() {
    return { left: 100, top: 100, right: 500, width: 300, height: 200 };
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  replaceChildren() {
    this.children = [];
  }
  append(child) {
    this.children.push(child);
  }
  focus() {}
  contains(target) {
    return !!target;
  }
  matches(selector) {
    return this.closest(selector) === this;
  }
  closest(selectors) {
    return selectors
      .split(",")
      .some((s) =>
        s === `[id]`
          ? !!this.id
          : s.startsWith("#")
            ? this.id === s.slice(1)
            : s.startsWith(".")
              ? this.classes.has(s.slice(1))
              : s === this.tag,
      )
      ? this
      : null;
  }
}

async function fixture() {
  let requestHandler;
  const backendPrompts = [],
    sends = [],
    timers = { setInterval: () => ({ unref() {} }), setTimeout: () => 1, clearTimeout() {} };
  class WebSocket {
    static OPEN = 1;
    readyState = 1;
    addEventListener() {}
    close() {}
  }
  const launcherContext = vm.createContext({
    launcherUrl: new URL("./polish", import.meta.url).href,
    fileURLToPath,
    path,
    createHash,
    process: {
      argv: ["node", "polish", "serve"],
      env: {},
      exit(code) {
        throw new Error(`Unexpected process.exit(${code})`);
      },
    },
    spawnSync: (command) => (command === "which" ? { stdout: "/fake/lavish-axi" } : { status: 0 }),
    realpathSync: (value) => value,
    createRequire: () => () => WebSocket,
    mkdir: async () => {},
    readFile: async (filename) => (filename.endsWith("state.json") ? '{"sessions":{}}' : html),
    createServer: (handler) => {
      requestHandler = handler;
      return { listen() {} };
    },
    fetch: async (_url, options) => {
      backendPrompts.push(JSON.parse(options.body).prompts[0]);
      return { status: 200, json: async () => ({ ok: true }) };
    },
    AbortSignal: { timeout: () => undefined },
    console: { log() {} },
    ...timers,
  });
  await new vm.Script(`(async () => {\n${launcherSource}\n})()`, {
    filename: "actual-prototype-launcher.js",
  }).runInContext(launcherContext);
  assert.equal(typeof requestHandler, "function");
  async function sendToActualRoute(body) {
    sends.push(structuredClone(body));
    const req = {
      method: "POST",
      url: "/api/send",
      headers: { host: "127.0.0.1:49792", origin: "http://127.0.0.1:49792" },
      async *[Symbol.asyncIterator]() {
        yield JSON.stringify(body);
      },
    };
    let status, result;
    const res = {
      setHeader() {},
      writeHead(code) {
        status = code;
        return this;
      },
      end(data) {
        result = JSON.parse(data);
      },
    };
    await requestHandler(req, res);
    return { ok: status >= 200 && status < 300, json: async () => result };
  }
  const elements = new Map();
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
    elements.set(match[3], new Element(match[3], match[1], match[2].match(/\bclass="([^"]*)"/)?.[1] || ""));
  }
  const main = new Element("", "main"),
    body = new Element("", "body"),
    documentListeners = new Map(),
    storage = new Map(),
    pending = [];
  elements.get("form").requestSubmit = () => {
    const task = elements.get("form").onsubmit({ preventDefault() {} });
    pending.push(task);
  };
  class FormData {
    constructor(form) {
      this.values = form.values || {};
    }
    get(name) {
      return this.values[name] ?? null;
    }
    getAll(name) {
      return this.values[name] || [];
    }
  }
  const pageContext = vm.createContext({
    document: {
      getElementById: (id) => elements.get(id),
      createElement: (tag) => new Element("", tag),
      body,
      querySelector: (selector) =>
        selector === "main" ? main : [...elements.values()].find((e) => e.classes.has("selected")),
      addEventListener: (type, handler) => documentListeners.set(type, handler),
    },
    window: {},
    FormData,
    crypto: { randomUUID },
    Node: { TEXT_NODE: 3 },
    getSelection: () => ({ rangeCount: 0, toString: () => "", removeAllRanges() {} }),
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    scrollY: 0,
    innerWidth: 1200,
    innerHeight: 900,
    addEventListener() {},
    location: { reload() {} },
    ...timers,
    fetch: async (url, options) =>
      url === "/api/send"
        ? sendToActualRoute(JSON.parse(options.body))
        : { ok: true, json: async () => ({ chat: [], connected: true, ended: false }) },
  });
  new vm.Script(pageSource, { filename: "actual-prototype-page.js" }).runInContext(pageContext);
  await flush();
  async function finish() {
    await flush();
    await Promise.all(pending);
    await flush();
  }
  return {
    elements,
    sends,
    backendPrompts,
    finish,
    storedThreads: () => JSON.parse(storage.get("polish-prototype-review-v1") || "[]"),
    async approve() {
      await elements.get("approve").onclick();
      await finish();
      if (!sends.length) elements.get("form").requestSubmit();
      await finish();
    },
    async submitForm() {
      const form = elements.get("confirmation-form");
      form.values = { verdict: "仍需调整", focus: ["文字选区", "页面内表单"], note: "整体说明再精简一点" };
      await form.onsubmit({ preventDefault() {}, currentTarget: form, submitter: new Element("", "button") });
      await finish();
    },
    async submitAnchored() {
      documentListeners.get("pointerup")({
        button: 0,
        target: elements.get("try-selection"),
        clientX: 200,
        clientY: 200,
      });
      elements.get("input").value = "请改短这一段";
      elements.get("input").oninput();
      elements.get("form").requestSubmit();
      await finish();
    },
  };
}

function assertSessionFeedback(f) {
  assert.equal(f.sends.length, 1);
  assert.equal(f.backendPrompts.length, 1);
  for (const key of ["block", "quote", "selector"]) {
    assert.equal(own(f.sends[0], key), false, `session /api/send must omit ${key}`);
    assert.equal(own(f.backendPrompts[0], key), false, `session backend prompt must omit ${key}`);
    assert.ok(
      f.storedThreads().every((t) => !own(t, key)),
      `session history must omit ${key}`,
    );
  }
  assert.equal(f.backendPrompts[0].text || "", "", "session feedback must not fabricate an element quotation");
  assert.equal(f.elements.get("pins").children.length, 0, "session feedback must not create a pin");
  assert.equal(
    [...f.elements.values()].some((e) => e.classes.has("selected")),
    false,
    "session feedback must not highlight an element",
  );
}

test("overall confirmation sends session feedback without scope-behavior anchor or pin", async () => {
  const f = await fixture();
  await f.approve();
  assertSessionFeedback(f);
  assert.match(f.sends[0].text, /确认这版功能/);
});

test("native overall form sends session feedback without form anchor, quote or pin", async () => {
  const f = await fixture();
  await f.submitForm();
  assertSessionFeedback(f);
  assert.match(f.sends[0].text, /仍需调整/);
  assert.match(f.sends[0].text, /整体说明再精简一点/);
});

test("located block comment retains its actual anchor, quotation and one numberless pin", async () => {
  const f = await fixture();
  await f.submitAnchored();
  assert.equal(f.sends.length, 1);
  assert.equal(f.sends[0].block, "try-selection");
  assert.equal(f.sends[0].quote, "try-selection content");
  assert.equal(f.backendPrompts[0].selector, "#try-selection");
  assert.equal(f.elements.get("pins").children.length, 1);
  assert.equal(f.elements.get("pins").children[0].textContent, "");
});
