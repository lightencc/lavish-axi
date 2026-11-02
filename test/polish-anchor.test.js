import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/artifact-sdk.js", import.meta.url), "utf8");
// Run the same self-contained resolver that is serialized inside the artifact SDK.
function resolver(document) {
  const start = source.indexOf("  function resolvePolishAnchor(");
  const end = source.indexOf("\n  function renderPolishPins", start);
  assert.ok(start >= 0 && end > start, "the SDK supplies its conservative anchor resolver");
  return vm.runInNewContext(`(${source.slice(start, end).trim()})`, { document });
}
function fixture(text = "Original block") {
  const element = {
    textContent: text,
    innerText: text,
    tagName: "P",
    childNodes: [{ textContent: text }],
    contains(node) {
      return node === this || this.childNodes.includes(node);
    },
  };
  const document = { querySelectorAll: (selector) => (selector === "#original" ? [element] : []) };
  return { element, document, resolve: resolver(document) };
}
test("reused block selector never attaches to different or merely similar text", () => {
  const f = fixture();
  const prompt = { selector: "#original", tag: "p", text: "Original block" };
  assert.equal(f.resolve(prompt), f.element);
  f.element.innerText = f.element.textContent = "Original block with replacement content";
  assert.equal(f.resolve(prompt), null);
  assert.equal(f.resolve({ ...prompt, selector: "#missing" }), null);
});
test("ambiguous selectors and truncated block identity stay unpositioned", () => {
  const f = fixture("x".repeat(300));
  assert.equal(f.resolve({ selector: "#original", text: "x".repeat(240) }), null);
  f.document.querySelectorAll = () => [f.element, f.element];
  assert.equal(f.resolve({ selector: "#original", text: "x".repeat(300) }), null);
});
test("text range resolves exact boundaries rather than a similar quote elsewhere", () => {
  const f = fixture("First paragraph Second paragraph");
  const boundary = { selector: "#original", path: [0], offset: 0 };
  const prompt = {
    selector: "#original",
    target: {
      type: "text-range",
      text: "First paragraph",
      rangeText: "First paragraph",
      start: boundary,
      end: { ...boundary, offset: 15 },
    },
  };
  f.document.createRange = () => ({ setStart() {}, setEnd() {}, toString: () => "First paragraph" });
  assert.equal(f.resolve(prompt), f.element);
  f.document.createRange = () => ({ setStart() {}, setEnd() {}, toString: () => "Changed passage" });
  assert.equal(f.resolve(prompt), null, "matching container text elsewhere cannot recover a changed range");
  assert.equal(f.resolve({ ...prompt, target: { ...prompt.target, start: null } }), null);
});

test("closing Polish selection clears native range so the next drag does not drag old text", () => {
  const start = source.indexOf("  function closeCard()");
  const end = source.indexOf("\n  // Apple platforms", start);
  for (const polishEnabled of [true, false]) {
    let cleared = 0;
    const close = vm.runInNewContext(`(${source.slice(start, end).trim()})`, {
      polishEnabled,
      activeCardContext: null,
      activeAttachments: null,
      shadow: null,
      hovered: null,
      selected: null,
      clearHighlight() {},
      clearTextHighlight() {},
      scheduleReviewStateReport() {},
      document: {
        getSelection: () => ({
          removeAllRanges() {
            cleared++;
          },
        }),
      },
    });
    close();
    assert.equal(cleared, polishEnabled ? 1 : 0);
  }
});
