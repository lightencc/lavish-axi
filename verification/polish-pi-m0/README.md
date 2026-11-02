# Pi M0 evidence — v1.2

Scope and limitations: [PLAN.md](PLAN.md), [Pi M0 report](../../docs/polish-pi-m0-report.md).

Safe verification (does not open a listener or call a model):

```sh
node --test verification/polish-pi-m0/inbox.test.js verification/polish-pi-m0/bridge.test.js
```

`probe.js` has already run once. It starts an isolated Pi instance, then binds the bridge and sends uniquely marked model requests. It refuses to overwrite its evidence. Do not rerun it as a routine unit test. This was component evidence, not browser evidence.

`serve.js` is prepared but has **not** run. It would start a dedicated Pi test instance, record identity, then bind a loopback listener at `127.0.0.1:49793` for up to ten minutes. The current instruction prohibits new listeners, so this specific action remains blocked pending explicit permission. Existing prototype ports and sessions must not be repurposed.

`host-extension.js` is explicitly loaded only in the test process. Do not install it globally. Its inbox is a candidate durable admission layer, not Pi's native queue or an exactly-once guarantee. Missing history is never evidence that an external call did not happen. Unknown dispatches are not automatically retried; stale ownership is not stolen.

The browser page is intentionally limited to whole-session submit/query. It does not implement realtime reconnect, ending/ended, annotation UI, multi-tool reply handling or production integration. Its browser behavior remains unverified.

`runtime/` is ignored and retains test host/bridge stores and session history. Evidence includes only selected protocol fields, structured IDs and final replies, without model reasoning or credentials. Initial RED logs, subsequent GREEN logs and prior-round evidence are retained.
