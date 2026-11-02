# Polish M0 verification

Controlled evidence for development spec v1.1. Overall result: **NO-GO**. See [the report](../../docs/polish-m0-report.md) for per-host G01–G07 results, scopes, failures, and unknown outcomes.

Read-only rechecks:

```sh
node --test verification/polish-m0/probe.test.js
python3 verification/polish-m0/analyze.py
```

The RPC recorder and crash probe send real model requests when explicitly run. The crash probe terminates only its own child. Do not automatically rerun host experiments while reviewing evidence. No production adapter is implemented here. `runtime/` contains isolated local sessions and generated schema; evidence and source hashes are retained separately.
