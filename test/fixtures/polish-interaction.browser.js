/* global document, window, location, getComputedStyle, PointerEvent, KeyboardEvent, NodeFilter */
// Pass this function to evaluate_script on an isolated formal /session/:key page.
// Never runs automatically. All write fetches are stubbed/blocked; GET/HEAD remain real reads.
// Opaque artifact frames stay opaque: do not relax sandbox or change origin for this test.
// Select text with native browser input when the returned nativeSteps list is nonempty.
async () => {
  const match = location.pathname.match(/^\/session\/([^/]+)\/?$/);
  if (!match) throw new Error("Use an isolated formal /session/:key page");
  const key = decodeURIComponent(match[1]);
  const api = `/api/${encodeURIComponent(key)}`;
  const get = (id) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Required Polish control missing: ${id}`);
    return element;
  };
  const dialog = get("polish-dialog"),
    input = /** @type {HTMLTextAreaElement} */ (get("polish-input")),
    send = get("polish-send");
  const overall = get("polish-overall"),
    complete = /** @type {HTMLInputElement} */ (get("polish-complete"));
  get("polish-refresh");
  const originalFetch = window.fetch;
  const writes = [],
    passed = [],
    skipped = [],
    nativeSteps = [];
  const assert = (condition, reason) => {
    if (!condition) throw new Error(reason);
  };
  const visible = (element) =>
    !element.hidden &&
    getComputedStyle(element).display !== "none" &&
    getComputedStyle(element).visibility !== "hidden";
  const wait = async (predicate, label) => {
    const deadline = performance.now() + 1800;
    while (!predicate()) {
      if (performance.now() >= deadline) throw new Error(`Timed out: ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
  const beforeResponse = await originalFetch.call(window, `${api}/review`, { cache: "no-store" });
  assert(beforeResponse.ok, "Review snapshot must be readable before running the fixture");
  const before = await beforeResponse.json();
  assert(before.lifecycle === "open", "Use an open isolated review, not an ended or draining review");
  window.fetch = async (resource, init = {}) => {
    const request = resource instanceof Request ? resource : null;
    const url = new URL(request ? request.url : String(resource), location.href);
    const method = String(init.method || request?.method || "GET").toUpperCase();
    if (!["GET", "HEAD"].includes(method)) {
      // Catch unexpected writes too: a fixture failure must never send a real user message.
      if (
        url.origin !== location.origin ||
        ![`${api}/prompts`, `${api}/review/complete`, `${api}/review/end`].includes(url.pathname)
      ) {
        throw new Error(`Fixture blocked unexpected write: ${method} ${url.pathname}`);
      }
      const raw = init.body ?? (request ? await request.clone().text() : "{}");
      const body = JSON.parse(String(raw));
      writes.push({ path: url.pathname, method, body });
      // No synthetic consumption, model reply or completion. Reads still return actual state.
      return Response.json({
        status: url.pathname.endsWith("/prompts") ? "queued" : "fixture-stubbed",
        pending_prompts: body.prompts?.length || 0,
        review: before,
      });
    }
    return originalFetch.call(window, resource, init);
  };
  let frameDocument = null;
  try {
    const frame = /** @type {HTMLIFrameElement | null} */ (
      document.querySelector("iframe#artifact-frame,iframe#artifact,iframe")
    );
    try {
      frameDocument = frame?.contentDocument;
      if (!frameDocument?.body) frameDocument = null;
    } catch {
      frameDocument = null;
    }
    const allPins = () => {
      if (!frameDocument) return [];
      const pins = [],
        roots = [frameDocument];
      for (const root of roots) {
        pins.push(...root.querySelectorAll(".polish-pin"));
        for (const element of root.querySelectorAll("*")) if (element.shadowRoot) roots.push(element.shadowRoot);
      }
      return pins;
    };
    const originalPinCount = allPins().length;
    overall.click();
    await wait(() => visible(dialog), "overall dialog opens");
    const existingReply = before.messages?.findLast(
      (m) => m.prompt?.scope === "session" && m.state === "replied" && !m.resolved,
    );
    if (existingReply) {
      const text = dialog.textContent || "";
      assert(
        text.includes(existingReply.reply?.text || "\u0000") || /已回复|新回复|刷新查看|待确认/.test(text),
        "Existing session reply must be visible or explicitly awaiting refresh",
      );
      assert(!complete.checked, "An agent reply must not automatically check user completion");
      passed.push("existing overall reply remains pending user confirmation");
    } else skipped.push("reply rendering: no existing unresolved session reply; no fake agent answer was injected");
    const originalInput = input.value;
    assert(!originalInput.trim(), "Use an isolated page without an unsent overall draft");
    input.value = "POLISH_UI_FIXTURE: overall feedback, never delivered";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    assert(complete.disabled, "Typing a new request must disable completion of an earlier reply");
    complete.click();
    await tick();
    assert(!writes.some((w) => w.path.endsWith("/review/complete")), "Disabled completion must not create a request");
    passed.push("new overall draft cannot mark a reply completed");
    send.click();
    await wait(() => writes.some((w) => w.path.endsWith("/prompts")), "stubbed overall submission");
    const submission = writes.find((w) => w.path.endsWith("/prompts")).body;
    assert(submission.review_epoch === before.epoch, "Overall submission must carry the current review epoch");
    assert(submission.prompts?.length === 1, "Expected one overall message");
    const prompt = submission.prompts[0];
    assert(prompt.scope === "session", "Overall submission must use session scope");
    for (const field of ["selector", "quote", "block", "tag", "text"]) {
      assert(!Object.prototype.hasOwnProperty.call(prompt, field), `Overall submission must omit fabricated ${field}`);
    }
    passed.push("overall submission contains no element anchor or quotation");
    await tick();
    if (frameDocument) {
      assert(allPins().length === originalPinCount, "Overall submission must not add an artifact pin");
      passed.push("overall submission does not add a pin");
    }

    const closeDialog = async () => {
      if (!visible(dialog)) return;
      const close =
        document.getElementById("polish-close") ||
        dialog.querySelector('button[aria-label="关闭"],button[aria-label="Close"]');
      if (close) close.click();
      else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await wait(() => !visible(dialog), "dialog closes before the next interaction");
    };
    if (!frameDocument) {
      skipped.push("iframe selection, native controls and shadow pins: artifact frame is opaque-origin or unavailable");
      nativeSteps.push(
        "Use native pointer selection on an artifact heading; release near its text; verify the outer polish-dialog opens beside the pointer with the selected quote.",
        "Close the dialog, select across two paragraphs, release outside the selected block, and verify the complete selected quote appears in the outer dialog.",
        "Close the dialog, interact with native input/select/checkbox controls and verify no annotation opens or message is submitted.",
        "Inspect artifact SDK shadow-root .polish-pin markers with browser inspector: no digits; global feedback creates no pin.",
      );
    } else {
      await closeDialog();
      for (const control of frameDocument.querySelectorAll("input,textarea,select,button,label")) {
        if (control.closest("[data-polish-ui]")) continue;
        control.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: 200, clientY: 200 }));
        await tick();
        assert(!visible(dialog), "A native form control opened an annotation");
      }
      passed.push("native controls do not open annotations");
      const textNode = (element, last = false) => {
        if (!element) return null;
        const walker = frameDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) if (node.textContent.trim()) nodes.push(node);
        return last ? nodes.at(-1) : nodes[0];
      };
      const select = async (start, end, label) => {
        if (!start || !end) {
          skipped.push(`${label}: fixture document lacks suitable text`);
          return;
        }
        await closeDialog();
        const range = frameDocument.createRange();
        range.setStart(start, 0);
        range.setEnd(end, end.textContent.length);
        const selection = frameDocument.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const selected = selection.toString().trim();
        end.parentElement.dispatchEvent(
          new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: 220, clientY: 220 }),
        );
        await wait(() => visible(dialog), label);
        assert(
          dialog.textContent.replace(/\s+/g, " ").includes(selected.replace(/\s+/g, " ").slice(0, 24)),
          `${label}: outer dialog lost the selected quote preview`,
        );
        selection.removeAllRanges();
        passed.push(label);
      };
      const heading = textNode(frameDocument.querySelector("h1,h2,h3"));
      await select(heading, heading, "heading selection opens outer dialog");
      const paragraphs = [...frameDocument.querySelectorAll("p")].filter(
        (p) => !p.closest("[contenteditable],button,label"),
      );
      await select(
        textNode(paragraphs[0]),
        textNode(paragraphs[1], true),
        "cross-paragraph selection opens outer dialog",
      );
      const pins = allPins();
      if (pins.length) {
        for (const pin of pins) assert(!/\d/.test(pin.textContent), "Pin visibly contains a number");
        passed.push("shadow-root pins have no visible numbers");
      } else skipped.push("pin appearance: no existing anchored pins; no real anchored message was sent");
      await closeDialog();
    }
    assert(!writes.some((w) => w.path.endsWith("/review/end")), "Fixture must not end the live review");
    return {
      passed,
      skipped,
      nativeSteps,
      stubbedWrites: writes.map((w) => ({ path: w.path, scope: w.body.prompts?.[0]?.scope })),
      realWrites: 0,
    };
  } finally {
    window.fetch = originalFetch;
  }
};
