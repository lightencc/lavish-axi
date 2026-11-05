import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../src/chrome-client.js", import.meta.url), "utf8");
test("Polish translates layout diagnostics and retains the upstream locale", () => {
  const fn = source.match(/function chromeText\(text\) \{[^]*?\n}/)?.[0];
  assert.ok(fn, "chrome localization function exists");
  const ctx = vm.createContext({ sessionData: { polish: true } });
  vm.runInContext(fn, ctx);
  assert.equal(vm.runInContext('chromeText("Layout issues")', ctx), "布局问题");
  assert.equal(vm.runInContext('chromeText("46 unresolved issues")', ctx), "46 个未解决问题");
  assert.equal(
    vm.runInContext('chromeText("Rendered text crosses its container\'s bottom edge by 932px and is hidden.")', ctx),
    "文字超出容器底部 932px，内容被隐藏。",
  );
  ctx.sessionData.polish = false;
  assert.equal(vm.runInContext('chromeText("Layout issues")', ctx), "Layout issues");
});
test("Polish defines light menu surfaces and keeps drawer header and footer from shrinking", () => {
  const css = readFileSync(new URL("../src/polish.css", import.meta.url), "utf8");
  assert.match(css, /--bg-bar: #fff/);
  assert.match(css, /--fg-dim: #475569/);
  assert.match(css, /\.polish \.warnings-foot[^}]*flex-shrink: 0/s);
});
test("text audit excludes text inside collapsed details", () => {
  const sdk = readFileSync(new URL("../src/artifact-sdk.js", import.meta.url), "utf8");
  const fn = sdk.match(/ {2}function textNodesForAudit\(el\) \{[^]*?\n {2}}/)[0];
  const visible = { nodeType: 3, textContent: "Visible summary", parentElement: { checkVisibility: () => true } };
  const hidden = { nodeType: 3, textContent: "Collapsed PR body", parentElement: { checkVisibility: () => false } };
  const ctx = vm.createContext({ isSemanticTextBoundary: () => true, el: { childNodes: [visible, hidden] } });
  vm.runInContext(fn, ctx);
  assert.deepEqual(Array.from(vm.runInContext("textNodesForAudit(el)", ctx)), [visible]);
});
