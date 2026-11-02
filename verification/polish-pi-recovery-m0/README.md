# Pi recovery M0 r1.1

Contract: [CONTRACT.md](CONTRACT.md). Results: [recovery report](../../docs/polish-pi-recovery-m0-report.md). Historical correction: [web evidence errata](../../docs/polish-pi-web-m0-errata.md).

No network listener is implemented or authorized here. Production files and installed Pi remain unchanged.

Run the local mechanism tests:

```sh
node --test verification/polish-pi-recovery-m0/authority.test.js verification/polish-pi-recovery-m0/ownership.test.js verification/polish-pi-recovery-m0/receipt.test.js verification/polish-pi-recovery-m0/drain.test.js
```

`ownership.test.js` creates and kills its own local fixture processes. Host receipts in unit/drain tests are explicit doubles. These tests do not invoke Pi or a model and cannot establish host exactly-once or production poll integration.

`probe-receipt-windows.js` has already run: two new dedicated Pi processes, one new model message each, deliberate SIGKILL at the recorded window, followed by read-only history queries. It refuses existing evidence and must not be used as a routine test or historical retry. The receipt-absent message remains unknown; never replay it.

`runtime/` retains isolated authority and Pi history for audit. `evidence/` holds selected raw events, final text, state snapshots, test diagnostics, source hashes and cleanup checks. No reasoning or credentials are exported. RED and intermediate failure logs are preserved; final local result is 23/23.

The coordinator is a minimal single-writer experiment. It does not claim production recovery through every storage fault, archival completeness, native Pi takeover, network synchronization or complete M0 acceptance.
