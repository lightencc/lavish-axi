# Pi web M0 — bounded browser run

See [the report](../../docs/polish-pi-web-m0-report.md).

This run used the unchanged v1.2 validation implementation under `verification/polish-pi-m0/`. Explicit permission covered only `127.0.0.1:49793`, for at most ten minutes. That listener and its owned Pi process have exited; the permission was not extended or reused.

The first request used browser fill/click. Thirty measured requests used the page's real form handler via requestSubmit, with real query-button clicks. Busy and crash-window cases also used the form. Aborted response, duplicate/conflict and invalid-binding cases used the same browser's local HTTP interface. No mocked replies or RPC-only substitutions were used for browser claims.

Evidence includes original selected host events, browser return values, HTTP request metadata, screenshots, all thirty samples, exact crash identity and state guards, and read-only post-crash records. Some browser-tool artifacts wrap JSON inside the tool's text response; these wrappers are retained deliberately. `assertions.json` records the corresponding machine-checked comparisons.

Final interrupted messages are retained in `cleanup-and-recovery.json`; **do not replay them**. The initial failed crash guard sent no signal, and both messages from that attempt completed; the final crash used a new pair of unique IDs. Historical unknown messages from earlier phases were never resubmitted.

The unchanged runtime directory is ignored by the earlier phase: `verification/polish-pi-m0/runtime/7f19c71e-d27f-4a0c-ba20-760522a3b261`. It retains the original stores and session history, including the stale host ownership lock. No recovery process was started.
