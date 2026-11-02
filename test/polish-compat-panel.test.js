import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/chrome-client.js", import.meta.url), "utf8");
const css = await readFile(new URL("../src/polish.css", import.meta.url), "utf8");

test("Polish uses an on-demand panel at both viewport sizes; legacy Lavish keeps its mobile sheet", () => {
  const body = source.match(/function isMobileSheet\(\) \{([\s\S]*?)\n\}/)[1];
  for (const polish of [true, false]) {
    for (const matches of [true, false]) {
      const result = vm.runInNewContext(`(() => {${body}})()`, {
        sessionData: { polish },
        sheetMedia: { matches },
      });
      assert.equal(result, !polish && matches);
    }
  }
});

test("Polish removes the permanent dock footprint and keeps a compact compatibility entry", () => {
  assert.match(css, /body\.polish\.panel-collapsed #panel\s*\{\s*display: none;/);
  assert.match(css, /\.polish \.layout\s*\{[^}]*grid-template-rows: minmax\(0, 1fr\)/);
  assert.match(css, /\.polish #panel\s*\{[^}]*transform: none;/);
  assert.doesNotMatch(source, /moreMenu\.appendChild\(sidebarToggle\)/);
  assert.match(css, /height: max\(0px, calc\(var\(--vv-height, 100dvh\) - var\(--bar-h\) - 20px\)\)/);
  assert.match(source, /panelToggle\.onclick = \(\) => setPanelCollapsed\(true\)/);
});

test("Polish compatibility panel opens and closes without sending, including narrow ended reviews", () => {
  const names = ["isMobileSheet", "setPanelCollapsed", "applyPanelCollapsed", "renderSidebarToggle"];
  const functions = names.map((name) => source.match(new RegExp(`function ${name}\\([^]*?\\n}`))[0]).join("\n");
  for (const matches of [false, true]) {
    const attributes = new Map();
    let focused = "";
    const panel = { contains: (element) => element === panel };
    const toggle = {
      focus: () => {
        focused = "toggle";
      },
      setAttribute: (name, value) => attributes.set(name, value),
      classList: { toggle() {} },
    };
    const classes = new Set();
    const context = vm.createContext({
      sessionData: { polish: true },
      sheetMedia: { matches },
      panelCollapsed: true,
      panelCollapsedStorageKey: "synthetic-panel",
      localStorage: { setItem() {}, removeItem() {} },
      unreadAgentReply: "",
      queued: [{ prompt: "Synthetic legacy pending answer" }],
      ended: true,
      document: {
        activeElement: panel,
        body: { classList: { toggle: (name, enabled) => (enabled ? classes.add(name) : classes.delete(name)) } },
      },
      panel,
      sidebarToggle: toggle,
      sidebarToggleCount: {},
      scrollPanelToBottom() {},
    });
    vm.runInContext(functions, context);
    vm.runInContext("applyPanelCollapsed()", context);
    assert.ok(classes.has("panel-collapsed"));
    assert.equal(attributes.get("aria-expanded"), "false");
    vm.runInContext("setPanelCollapsed(false)", context);
    assert.equal(attributes.get("aria-expanded"), "true");
    assert.equal(classes.has("panel-collapsed"), false);
    vm.runInContext("setPanelCollapsed(true)", context);
    assert.equal(focused, "toggle", "closing restores focus to the visible compatibility entry");
    assert.equal(context.queued.length, 1, "opening or closing never sends or changes legacy drafts");
  }
});
