import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { parse } from "parse5";
import { createChromeHtml } from "../src/server.js";

const elements = (node) => (node.childNodes || []).filter((child) => child.tagName);
const descendants = (node) => elements(node).flatMap((child) => [child, ...descendants(child)]);
const attr = (node, name) => node.attrs?.find((entry) => entry.name === name)?.value;

// Resolve the span/:last-child subset on the actual served tree, in DOM preorder.
// In particular, a nested last child is visited before its parent's following sibling.
function select(root, selector) {
  const direct = selector.startsWith(":scope > ");
  const simple = selector.replace(/^:scope > /, "");
  assert.equal(simple, "span:last-child", "Extend the selector adapter for a new selector shape");
  return (direct ? elements(root) : descendants(root)).find(
    (node) => node.tagName === "span" && elements(node.parentNode).at(-1) === node,
  );
}

for (const pressed of [false, true]) {
  test(`Polish labels the outer switch text and leaves the knob empty (${pressed})`, async () => {
    const tree = parse(createChromeHtml({ key: "label-test", file: "/tmp/label-test.html" }));
    const toggle = descendants(tree).find((node) => attr(node, "id") === "annotation");
    const knob = descendants(toggle).find((node) => attr(node, "class") === "switch-knob");
    const label = elements(toggle).at(-1);
    toggle.attrs.find((entry) => entry.name === "aria-pressed").value = String(pressed);
    const text = new Map([
      [knob, ""],
      [label, "Annotate"],
    ]);
    const source = await readFile(new URL("../src/chrome-client.js", import.meta.url), "utf8");
    const statement = source.match(/annotationSwitch\.querySelector\([^;]+\.textContent = "评论";/)?.[0];
    assert.ok(statement, "Run the production Polish label assignment");
    vm.runInNewContext(statement, {
      annotationSwitch: {
        querySelector(selector) {
          const target = select(toggle, selector);
          assert.ok(target);
          return {
            set textContent(value) {
              text.set(target, value);
            },
          };
        },
      },
    });
    assert.equal(text.get(label), "评论", "The visible accessible label must be translated");
    assert.equal(text.get(knob), "", "The decorative 16px knob must never contain text");
    assert.equal(attr(toggle, "aria-pressed"), String(pressed));
  });
}
