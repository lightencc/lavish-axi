# Final native UI regression

`verified-*` files are the final passing run. `verify-evidence.mjs` checks the recorded outcomes. This uses the production `/session/:key` page and SDK served from source with an isolated test host; it is not a Pi model performance run.

Native mouse dragging selected `#first` offset 6 through `#second` offset 30. After submission another native drag released in the outer toolbar opened the comment. No synthetic Range/Selection was used to make these selections. The native keyboard shortcut was checked for the overall-comment entry, not claimed as proof of keyboard-made precise text selection. Native input and action buttons were exercised before revising the fixture on disk and clicking Refresh.

Replacing the original block at the same selector with similar but different text removed that block's pin, preserved its discussion and displayed `原内容位置已变化`. The cross-paragraph comment kept one numberless pin. The 360×640 popup stayed within x=12..348, y=84..525.33; its send button bottom was 508.33.

The earlier `*-before`, `native-*`, and `final-*` diagnostic attempts are not final passing evidence. The diagnostics exposed native selection being left behind on close: a subsequent drag starting inside that selection began browser text drag-and-drop. The final fix clears the native range while keeping Polish's newly opened highlight. It also preserves the upstream mode hotkey in its separate handler. CDP helper scripts may need `POLISH_UI_CDP_PORT_FILE` set to the owned test browser's current DevToolsActivePort; they must not attach to a user's browser.

## Real Pi functional acceptance

`product-functional-summary.json` combines the successful assertions in `product-final-5/results.json` (three native anchored comments, real HTML title and introduction revisions, refresh/completion, and native inline form submission) with `product-final-11/results.json` (real disconnect/reconnect, draft and form retention, closing one of two tabs, and confirmed end). The host launch is `c4212554-dbab-4e1e-b1b1-96d553159883`, running extension hash `b014ab…`. Its chrome client, Polish client, CSS, server, and CLI hashes match the later `b640…` build; the extension differs. This functional result does not substitute for final-build performance samples.

All 27 IDs in the end receipt were consumed. The final message is the overall confirmation, not the unsent A09 draft. Automatic tab closure was refused by the browser; `product-final-11/ended-ui.json` records the actual “通信已结束 · 可以关闭此页” fallback before explicit cleanup of the owned browser. Cleanup is in `function-cleanup.json`.

The remaining-phase script actually used is `product-finish-v6.mjs`, with its command saved in `product-final-11/command.sh`. It closes the observed native WebSocket, immediately sets real browser networking offline, observes failed reconnect, restores online networking, and compares the complete draft/form values and message count. Earlier attempts preserve tool failures: missing CDP Page enable, stale iframe tokens during reload, hanging CDP calls, screenshot timeout, and select-all failing to replace earlier test text. No successful model input was replayed to recover these harness failures. Repeated draft text is retained as actual before/after evidence and was never submitted.

`selection-final-3/selection-timing.json` records five native drags on the real Pi page: mouseup-to-popup DOM-visible times 16.30, 1.70, 1.30, 1.20, and 1.20 ms, with before/after iframe/top clock calibration. It measures DOM visibility rather than raster paint. `selection-final-1` and `selection-final-2` are failed tool diagnostics.

`performance-final-1` and `performance-final-2` are pre-fix diagnostics, not the final accepted benchmark. They retain the 90-second timeout followed by a 110.8-second reply, and the provider retry/host stale-failure bug that was subsequently fixed. Never rewrite those original failed rows as timely successes. Final native-driver sampling uses `benchmark-ui-native.mjs`; it captures actual send-click timestamps and refreshes prior reply state between samples.

## Final build browser sampling

`performance-final-3/ui-results.json` is the final `b640…` build sample: 30 overall comments plus 3 anchored comments, all 33 completed, zero timeout/failure/incomplete, one unique prompt ID each. `summary.json` gives nearest-rank percentiles and keeps the two groups separate. The original per-row JSONL, actual native click timestamps, browser clock ID, frame pin events, reply claims, and reproduction command are retained. Each row used the visible Refresh control to clear prior unread reply state. Three anchored samples show the processing-orange border and empty pin text. This is 33 actual native UI submissions, not HTTP submission emulation.

For the 30 overall samples, local feedback p50/p95 was 2.6/4.8 ms, acknowledgement 58.1/64.0 ms, consumed-state visibility 137.3/149.1 ms, and reply visibility 1745.2/3545.1 ms. Tool preparation time precedes the actual click and is excluded. These raw UI numbers are not a claim about bridge-only overhead; the parent acceptance report joins calibrated source traces for that decomposition. Earlier failed diagnostic benchmarks remain separate and unchanged.
