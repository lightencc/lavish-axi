# Supplemental M0 evidence

See [the supplemental report](../../docs/polish-m0-supplement-report.md) for scope, findings, gate status and limitations. This directory is an isolated feasibility experiment, not a production adapter.

- `ledger.js`, `pi-extension.js`: local deduplication and structured identity candidate.
- `ledger.test.js`: five local contract checks (`node --test verification/polish-m0-supplement/ledger.test.js`).
- `run-extension-probe.js`: the already-executed, bounded real-host probe. Do not rerun as routine verification; it makes model requests and deliberately kills its own test process. It refuses to overwrite existing evidence.
- `evidence/extension-events.jsonl`: selected events captured during the single probe; not a complete RPC transcript. In particular, independent extension-error events were not captured.
- `evidence/experiment-summary.json`: read-only assertions over those events and owned-process cleanup check.
- `evidence/unit-red.txt`, `unit-cleanup-failure.txt`, `unit-green.txt`: original test history, preserved without rewriting.
- `runtime/`: ignored local session history and ledger; retained for inspection. The crash claim is intentionally retained. Do not remove it to trigger automatic replay.

The supplementary `supp-unknown-001` and first-round `fault-active` / `fault-queued` remain unresolved. No automatic resend is authorized by these artifacts. Same-history recovery in another process is not evidence of attaching to the original live session.

The evidence manifest hashes supplemental code, reports and evidence, excluding itself and runtime. Original first-round files and the v1.1 specification are verified separately in `first-round-preserved-after.json`.
