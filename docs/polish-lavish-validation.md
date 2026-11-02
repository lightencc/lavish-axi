# Polish default Lavish-flow verification

Checked: 2026-10-31T07:28:00Z. Default route: original Lavish skill/CLI/poll. Package version remains 0.1.96; this uncommitted build is identified by the hashes below, not by the former Channels preview version.

The user's latest decision replaces the Channels-required architecture. Natural-language/context artifact generation stays in the skill; the CLI reuses Lavish opening, daemon discovery, long-poll, reply and end. Existing HTML is opened unchanged. Pi remains on its explicitly bound host endpoint. The experimental Channel implementation and old evidence are retained, not the default installation path.

## Results

- `pnpm run check`: exit 0; 1,770 total, 1,762 passed, 0 failed, 8 conditional skips. Includes build, lint, formatting, typecheck, original Lavish and Pi tests, skill/plugin freshness.
- `test/polish-lavish-flow.test.js`: 3 passed on the final build. Actual built CLI open (including options before the path), poll, reply and end; actual HTTP/SessionStore/WebSocket; whole-page and anchored feedback over multiple rounds; native form bytes preserved; completion guarded by viewed artifact identity; already-waiting poll awakened by webpage end; final batch then marker; user end requires explicit reopen; CLI end preserves queued feedback and ordinary agent-ended reopen works.
- Known pre-response disconnect restores the exact poll claim to accepted, preserving Lavish behavior; restore publishes authoritative state and wakes waiting consumers. Other host modes retain their unknown-result protection. A successful poll response is the existing Lavish delivery boundary, not proof of model context consumption.
- Independent read-only review found the three integration regressions (end wake, pre-response restore, CLI end/reopen); they were reproduced and fixed. Reviewer reread the final recovery notification code and withdrew an earlier stale-code finding. No remaining blocking issue found within this scope.
- Skill tests verify natural-language/context generation instructions are reused from the Lavish generator and the existing-file branch is retained. These are instruction/packaging checks, not a real model generating HTML.
- Final default-flow browser acceptance passed against `dist/cli.mjs server --port 0` and `dist/polish` on loopback. Existing HTML unchanged; anchored and overall feedback through actual poll/reply; reply refresh and completion removes its pin; native form submission with `data-lavish-question` on its container preserves its value after refresh; unsent offline draft survives reload and sends once; final batch plus marker wakes an already-waiting poll and drains before ended; user-ended ordinary open is refused and explicit reopen enters epoch 2. The test client replaces the model, not the browser or protocol.
- A real browser check exposed misleading unknown-submission text after reload. The page kept sending disabled correctly but showed an unsent draft. A failing regression was added, then the UI was minimally fixed to retain the explicit “发送结果待核实 · 请勿重复发送” status. Client tests: 19 passed. Final built-browser rerun passed with screenshots and 68 HAR requests, all to its own loopback service; the only failed requests were the deliberately offline submit/query. Browser console and uncaught error collections were empty.
- Unknown submission recovery is intentionally limited: the original identity/draft is retained and refresh queries authoritative state. An absent receipt does not trigger resend or automatically unlock sending. This safety result is not an automatic-recovery pass. No unknown historical message was resent.
- CSS/chrome/Pi/CLI hashes remain unchanged; only the Polish client asset changed for this status fix. Seven opt-in browser suites and one Windows-only test remain skipped; the new dedicated browser exercise is separate and is not counted among unit-test passes.
- No real Claude model, Herdr pane, or fresh real Pi model session was run. No Channels consent was accepted. Real model execution and Herdr discovery remain untested.

## Ownership and data

No user/global MCP configuration, authentication, credentials or skill installation was changed. No commit, push, deployment or upload. Existing user records/cache are untouched. Before build, no project-specific running process was observed. All test data was synthetic in unique temporary directories. An early fixture with an empty server version caused the original CLI to replace its own test server; its dedicated temporary log proved ownership, and its own HTTP shutdown was used. The fixture now reports the matching package version and holds its own WebSocket; final tests close their own services.

Personal skill conflict check: `~/.claude/skills/polish` does not currently exist; `polish` is not on this shell's PATH. Installation remains a user action. The only required personal artifact is `~/.claude/skills/polish/SKILL.md`, copied from this repository's generated skill with CLI commands pointing to the absolute local `dist/polish` executable. Do not copy the experimental integrations/claude skill. No MCP or Channels configuration is required.

## Evidence

`verification/polish-lavish-browser/final-check.log` is the final check. The earlier `verification/polish-lavish-default/full-check.log` remains the prior build baseline. `initial-red.log`, `review-red.log`, `end-red.log`, and `flags-red.log` preserve reproduced failures using fictional artifacts. Older Pi and Channels evidence is retained separately. The former `docs/polish-claude-plan.md` and `docs/polish-claude-validation.md` now explicitly mark their default architecture as superseded.

## SHA256

- `dist/polish`: `d0c5ddc5c6d48c6e756d4a2288ef05440dcb6f02e333e43b5ba5e6886e5de6b6`
- `dist/cli.mjs`: `d5c7cf441b315d48e5aee2821e2412e3e2dc17db878b1d78a117ef98616eb1db`
- `dist/server.mjs`: `93e5aff4c7b0713ea052f27a4a414aa77e18f22fade5bc6e6c5298f1c0d34cab`
- `dist/pi-extension.mjs`: `81b0d1fa64e4448d89d1f7c9d771e456069425c915e84a50790d0a0dfaa57a26`
- `dist/polish-client.js`: `506fa78f171238d46d72f8e5e10ff98b6d1d81365d73c4ccee9e3d08ec6c89d0`
- `dist/polish.css`: `75dbd3cef9c1ad235a4fdf463b56b413d6c193879db53d28d5c3c9d3db9faf81`
- `dist/chrome-client.js`: `ec5f4becf0e212b6d035df8a466cda12c3419dd0ab68821065b60f6eb846da08`
- `skills/polish/SKILL.md`: `a4eda3435906f5231998e5815e9e6dedd1687565a38533328740e2b1c8103c2a`

## Browser evidence and cleanup

Final run: `verification/polish-lavish-browser/df104a3f-3522-4f5f-812f-4955d3c88e0c/` (`results.json`, `network.har`, `server.log`, eight screenshots, synthetic `fixture.html`). It ran 07:26:41–07:27:09 UTC using its own PID 62487 and 127.0.0.1:65000. The child exited successfully, its dedicated browser closed, and an HTTP probe confirmed port release. Temporary fixture/state was removed.

`unknown-status-red.log` and `unknown-status-green.log` preserve the UI regression and repair. Earlier UUID runs preserve harness corrections (JSON/frame reads, refresh readiness, completion auto-close, proper form-container annotation) and the intentionally overstrict unknown-resend assumption; they are not product passes. One built-server startup probe initially failed because lsof resolved the numeric address. PID 64472 was confirmed as a child of this exact test runner and closed with its own `/shutdown` (200); its port 61660 was then absent. The runner now uses numeric lsof output, records its child PID before discovery, and terminates only its own child if startup discovery fails. No unrelated listener was stopped.

## Installation handoff (not executed)

`verification/polish-lavish-browser/install-preview/SKILL.md` is a prepared copy of the generated default skill with inline CLI commands rewritten to this checkout's absolute `dist/polish` path. It keeps the `/polish` skill name and natural-language/context/existing-file branches. `manifest.json` records both hashes and the intended destination. Only after user approval, recheck that `~/.claude/skills/polish` is absent (including symlinks), create it without overwriting, and copy this preview as `SKILL.md`. Do not install the experimental Claude integration, MCP settings or Channels. Start a fresh ordinary Claude session and try `/polish /absolute/path/example.html`; natural-language and empty-argument model behavior, plus Herdr's discovery, still need user/real-model validation.
