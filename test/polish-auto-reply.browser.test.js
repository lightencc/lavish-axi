/* global window, document, getSelection, innerWidth */
import { serve } from "../src/server.js";
import { sessionKey, canonicalFile } from "../src/session-store.js";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
test(
  "live Polish replies preserve interaction across reconnect and narrow screens",
  { skip: process.env.POLISH_REPLY_BROWSER_E2E !== "1", timeout: 60000 },
  async () => {
    const { chromium } = await import(process.env.POLISH_BROWSER_PLAYWRIGHT_MODULE || "playwright");
    const repo = fileURLToPath(new URL("..", import.meta.url));
    const dir = await mkdtemp(path.join(tmpdir(), "polish-auto-reply-"));
    const out = process.env.POLISH_BROWSER_OUTPUT_DIR || dir;
    const file = path.join(dir, "synthetic.html");
    await writeFile(
      file,
      '<!doctype html><html><head><meta charset="utf-8"><title>自动回复回归</title></head><body style="margin:40px;font:18px/1.7 system-ui"><h1>自动回复回归测试</h1><p id="sample" style="max-width:500px">仅用于自动回复的合成内容，没有真实用户反馈。</p><p>此测试页与复盘页面隔离。</p></body></html>',
    );
    let server, browser;
    const results = [];
    try {
      server = await serve({
        version: "0.1.96",
        port: 0,
        hosts: ["127.0.0.1"],
        stateFile: path.join(dir, "state.json"),
        idleTimeoutMs: null,
        detectTailscale: async () => null,
      });
      const base = `http://127.0.0.1:${server.port}`,
        key = sessionKey(await canonicalFile(file));
      await promisify(execFile)(process.execPath, [repo + "/dist/polish", "--no-open", file], {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          LAVISH_AXI_STATE_DIR: dir,
          LAVISH_AXI_PORT: String(server.port),
          LAVISH_AXI_HOST: "127.0.0.1",
          LAVISH_AXI_TELEMETRY: "0",
          LAVISH_AXI_NO_OPEN: "1",
        },
        timeout: 15000,
      });
      const read = async () => await (await fetch(`${base}/api/${key}/review`)).json();
      const post = async (route, body) => {
        let r = await fetch(base + route, {
          method: "POST",
          headers: { "content-type": "application/json", Origin: base },
          body: JSON.stringify(body),
        });
        assert.equal(r.status, 200, await r.clone().text());
        return r.json();
      };
      const poll = async () =>
        await (await fetch(`${base}/api/poll?file=${encodeURIComponent(file)}&timeoutMs=50`)).json();
      browser = await chromium.launch({ headless: true, channel: "chrome" });
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
        page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      let navigations = 0;
      page.on("framenavigated", () => navigations++);
      await page.goto(`${base}/session/${key}`);
      await page.waitForFunction(() => /** @type {any} */ (window).__lavishChromeReady);
      await page.locator("#polish-overall").waitFor();
      const prompt = {
        prompt_id: "auto-first",
        round_id: "auto-round",
        comment_id: "auto-thread",
        scope: "anchored",
        selector: "#sample",
        text: "仅用于自动回复的合成内容，没有真实用户反馈。",
        prompt: "请核查这段合成内容。" + " 阅读位置保持测试。".repeat(40),
      };
      await post(`/api/${key}/prompts`, { review_epoch: 1, prompts: [prompt] });
      await poll();
      const frame = page.frameLocator("#artifact"),
        pin = frame.locator(".polish-pin");
      await pin.waitFor();
      await pin.click();
      await page.locator("#polish-input").fill("这是还没有发送的追问，请保留。");
      // Synthetic test only: establish an input caret and reader scroll, then deliver a real server reply.
      const before = await page.evaluate(() => {
        const i = /** @type {HTMLTextAreaElement} */ (document.querySelector("#polish-input")),
          h = document.querySelector("#polish-history");
        i.focus();
        i.setSelectionRange(3, 9);
        h.scrollTop = 23;
        /** @type {any} */ (window).testUserNode = h.firstChild;
        return { scroll: h.scrollTop, dialog: document.querySelector("#polish-dialog").scrollTop };
      });
      const navBefore = navigations;
      await post(`/api/${key}/agent-reply`, { text: "第一条回复已自动显示。" });
      await page.waitForFunction(() =>
        document.querySelector("#polish-history").textContent.includes("第一条回复已自动显示。"),
      );
      const after = await page.evaluate(() => {
        const i = /** @type {HTMLTextAreaElement} */ (document.querySelector("#polish-input")),
          h = document.querySelector("#polish-history");
        return {
          draft: i.value,
          focus: document.activeElement === i,
          start: i.selectionStart,
          end: i.selectionEnd,
          scroll: h.scrollTop,
          dialog: document.querySelector("#polish-dialog").scrollTop,
          same: /** @type {any} */ (window).testUserNode === h.firstChild,
        };
      });
      assert.deepEqual(after, {
        draft: "这是还没有发送的追问，请保留。",
        focus: true,
        start: 3,
        end: 9,
        scroll: before.scroll,
        dialog: before.dialog,
        same: true,
      });
      assert.equal(navigations, navBefore);
      assert.equal((await read()).messages[0].resolved, false);
      results.push({
        test: "open popup + draft + focus/caret + scroll + node identity + no reload/manual completion",
        pass: true,
      });
      // A second real feedback round with a selected DOM text range while its reply arrives.
      await page.locator("#polish-input").fill("第二轮合成追问");
      await page.locator("#polish-send").click();
      await poll();
      await pin.click();
      const selection = await page.evaluate(() => {
        const t = document.querySelector(".polish-user").firstChild,
          r = document.createRange();
        r.setStart(t, 0);
        r.setEnd(t, 5);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        /** @type {any} */ (window).selectedNode = t;
        return s.toString();
      });
      await post(`/api/${key}/agent-reply`, { text: "第二轮回复自动追加，保留已有选区。" });
      await page.waitForFunction(() =>
        document.querySelector("#polish-history").textContent.includes("第二轮回复自动追加"),
      );
      assert.deepEqual(
        await page.evaluate(() => ({
          text: getSelection().toString(),
          same: getSelection().anchorNode === /** @type {any} */ (window).selectedNode,
        })),
        { text: selection, same: true },
      );
      results.push({ test: "existing history text selection retained on new reply", pass: true });
      await page.locator("#polish-close").click();
      await post(`/api/${key}/prompts`, {
        review_epoch: 1,
        prompts: [{ ...prompt, prompt_id: "collapsed", round_id: "collapsed-round", prompt: "折叠状态的合成追问" }],
      });
      await poll();
      await page.waitForTimeout(100);
      await pin.focus();
      await post(`/api/${key}/agent-reply`, { text: "收起时收到的回复，再打开直接可见。" });
      await page.waitForTimeout(250);
      assert.equal(
        await pin.evaluate((e) => e.getRootNode().activeElement === e),
        true,
        "pin keyboard focus survives a reply",
      );
      assert.equal(await page.locator("#polish-dialog").isVisible(), false);
      await pin.click();
      await page.locator(".polish-agent").filter({ hasText: "收起时收到" }).waitFor();
      results.push({ test: "collapsed pin receives reply without reopening, shows latest when opened", pass: true });
      // Exact duplicate reply is idempotent server-side; no duplicate UI paragraphs.
      await post(`/api/${key}/agent-reply`, { text: "收起时收到的回复，再打开直接可见。" });
      await page.waitForTimeout(200);
      assert.equal(await page.locator(".polish-agent").filter({ hasText: "收起时收到" }).count(), 1);
      results.push({ test: "duplicate notification/reply does not duplicate body", pass: true });
      await page.locator("#polish-input").fill("断线时的未发送草稿");
      await post(`/api/${key}/prompts`, {
        review_epoch: 1,
        prompts: [{ ...prompt, prompt_id: "offline", round_id: "offline-round", prompt: "断线恢复合成测试" }],
      });
      await poll();
      await context.setOffline(true);
      await page.waitForTimeout(500);
      await post(`/api/${key}/agent-reply`, { text: "离线期间到达，重连自动补齐。" });
      await context.setOffline(false);
      await page.waitForFunction(
        () => document.querySelector("#polish-history").textContent.includes("离线期间到达"),
        null,
        { timeout: 20000 },
      );
      assert.equal(await page.locator("#polish-input").inputValue(), "断线时的未发送草稿");
      results.push({ test: "offline/reconnect authoritative snapshot updates reply and preserves draft", pass: true });
      for (const width of [320, 390, 768]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(100);
        const layout = await page.locator("#polish-dialog").evaluate((e) => {
          const r = e.getBoundingClientRect();
          return { left: r.left, right: r.right, width: innerWidth, overflow: e.scrollWidth > e.clientWidth };
        });
        assert.ok(layout.left >= 0 && layout.right <= width && !layout.overflow, JSON.stringify(layout));
        assert.equal(await page.locator(".polish-agent").filter({ hasText: "离线期间到达" }).count(), 1);
        results.push({ test: `narrow ${width}px reply readable without horizontal clipping`, pass: true });
      }
      await page.setViewportSize({ width: 390, height: 900 });
      await page.locator("#polish-history").evaluate((e) => (e.scrollTop = e.scrollHeight));
      await page.screenshot({ path: path.join(out, "reply-mobile.png") });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: path.join(out, "reply-desktop.png") });
      assert.equal(errors.length, 0, errors.join("\n"));
      results.push({ test: "browser uncaught exceptions", pass: true, count: errors.length });
      await writeFile(
        path.join(out, "browser-results.json"),
        JSON.stringify(
          {
            time: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }),
            base,
            results,
            navigationsBeforeReply: navBefore,
            navigationsAfterReply: navigations,
            liveUserSessionTouched: false,
          },
          null,
          2,
        ),
      );
      console.log(JSON.stringify(results, null, 2));
    } finally {
      if (browser) await browser.close();
      if (server) await server.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
