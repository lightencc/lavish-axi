> Superseded for the default workflow: the user selected the original Lavish skill/CLI/poll path. This document records the optional experimental Channels implementation only; it is not an installation requirement. See README.

# Claude Code adapter validation

Status: implementation and isolated protocol/product integration are ready; real Claude acceptance is pending. Do not describe this as a verified Claude end-to-end release.

Checked: 2026-10-31T04:16:46.431943+00:00. Product adapter version: `0.1.96-claude.2`. Repository base remains `69bf3090b24a04773ffd05d2e0b23d91ca41923b` with prior Pi work and this adapter uncommitted. No commit, push, deployment or data upload was performed.

## Implemented

- Current-process MCP Channel, official SDK 1.32.2 and Zod 4.6.7; distinct Claude plugin layout and session-scoped launcher. Existing root Agent Plugins metadata remains unchanged.
- Explicit session identity from the Claude skill substitution, one-session process binding, channel-only probe before opening any page.
- Durable admission and dispatch intent, private exact receipt challenge, separate consumer acknowledgement and reply tools; identical retries are idempotent and conflicting outcomes fail.
- Restart retains original identity/port and never resends a previously attempted unknown message. Consumed interruption remains execution-unknown. Only an explicit exact receipt/reply clears uncertainty.
- Existing Polish page/store/end/completion path reused. Pi witness semantics preserved; Claude tool acknowledgements are a separate binding-selected evidence type. Browser callers cannot forge receipt routes, host identity or witness type.
- Canonical HTML asset and private receipt-storage trees may not overlap. Both MCP open and direct HTTP open enforce this boundary.
- No Herdr socket access, no taskforge-mvp modification, no transcript scraping, no replacement `claude -p`, no permission relay or persistent MCP installation.

## Evidence and limits

| Check                                                        | Result                                                           | Meaning                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run check`                                             | Exit 0; 1,766 total, 1,758 passed, 0 failed, 8 conditional skips | Build/lint/format/typecheck/default tests and skill/plugin freshness passed.                                                                                                                                                                                                      |
| `test/claude-host.test.js`                                   | 10 passed                                                        | Notification is not consumption; exact receipt/reply; dedup/serialization; accepted-first-send recovery; ambiguous send; interrupted consumption; exclusive ownership; final batch + marker drain without model replies; unknown final blocks across restart until exact receipt. |
| `test/claude-channel.test.js`                                | 2 passed                                                         | Real HTTP + real SessionStore + official MCP in-memory transports; probe gating, identity rejection, origin/private-state enforcement, reply visibility, sealed end and cleanup. Consumer is synthetic.                                                                           |
| `test/claude-stdio.test.js`                                  | 3 passed                                                         | Built MCP process, real stdio and owned-process SIGKILL/restart; default isolated launch, safe option normalization and conflicting/unsafe option rejection. Old unknown event is not emitted again; late exact receipt reconciles.                                               |
| Additional regression assertions                             | Passed                                                           | Binding-selected Claude/Pi witness rejection and conflicting endpoint prevention.                                                                                                                                                                                                 |
| `claude plugin validate --strict ./dist/claude-plugin`       | Exit 0, Validation passed                                        | Informational catalog icon warning; no runtime manifest validation error. Does not prove channel activation.                                                                                                                                                                      |
| Installed Claude                                             | 2.1.314                                                          | Version probe only.                                                                                                                                                                                                                                                               |
| Read-only auth status                                        | loggedIn=true, oauth_token, firstParty                           | Configuration exists. Does not prove account/model access or Channels policy permits use.                                                                                                                                                                                         |
| Real Claude model / idle wake / busy delivery / UI behaviour | Not tested                                                       | Needs an authorized dedicated interactive session and the user's development-channel confirmation.                                                                                                                                                                                |
| Herdr launch and existing-session resume                     | Not tested                                                       | Herdr must use the documented supported launch options; unknown/configuration overrides now fail closed. No existing Herdr session was touched.                                                                                                                                   |
| Fresh real Pi model run                                      | Not repeated                                                     | Pi unit/integration regressions passed. Existing frontend asset hashes remain identical; shared bundled code changes mean not all six old build hashes still match.                                                                                                               |

Current full check log: `verification/polish-claude/repair-full-check.log`. Prior `.1` logs remain intact. Reproduced failures are preserved in `repair-red-targeted.log` (4 failures) and `repair-red-http.log` (ending timeout), in the same directory. The first sandbox-only attempt also encountered listener EPERM; the supported authorized local-test run then reproduced the actual ending failure. These logs contain synthetic tests, not a real Claude transcript. Test-created servers/processes are closed; the stdio test verifies the old endpoint rejects connections after shutdown and crash. There is no running live Claude test instance.

## Repair review (.2)

- Removed model-reply gating from serial dispatch. A consumed but unreplied A no longer strands final B and the end marker. The real HTTP/SessionStore + synthetic MCP test now reaches ended without any replies, then verifies a late reply does not reopen it.
- Unknown/unconsumed input still blocks dispatch. A new test preserves unknown final B over restart, observes no replay, then uses its original exact receipt to allow the marker.
- Launcher defaults to strict MCP isolation, default interactive permission mode and no Chrome integration. Safe equal/space forms and aliases normalize; conflicting values, permission bypass, alternate MCP/channel/settings/plugin configuration and unknown flags are refused before spawn.
- Independent read-only review of these three changes found no remaining defect. This is not real Claude model acceptance.
- Pi extension, Polish CLI, frontend assets, server and main CLI hashes are unchanged from `.1`; all applicable Pi/default regressions passed again. No fresh real Pi session was started.

## Ready-to-review real-test scope

Use only the prepared fictional page and a dedicated interactive Claude session. Start without changing persistent MCP configuration or credentials:

```sh
cd /Users/lightencc/Documents/Codex/2026-10-30/task/claude-live-test
POLISH_CLAUDE_STATE_ROOT="$PWD/state" /Users/lightencc/Documents/Projects/polish-axi/dist/polish-claude
```

The launcher defaults to `--strict-mcp-config --permission-mode default --no-chrome`; adding these same options explicitly is redundant and accepted. Other configuration/permission overrides are rejected. This isolates MCP configuration, not all user skills/hooks; existing organization policy remains authoritative. The user must confirm the development channel warning for `server:polish` in the terminal. Existing normal tool approvals remain in effect. Then enter:

```text
/polish /Users/lightencc/Documents/Codex/2026-10-30/task/claude-live-test/artifacts/review.html
```

Verify actual session ID matches the binding, first probe succeeds, one whole-page comment and one anchored comment reach that session, tools acknowledge and reply to exact identities, page refresh reveals the replies, user completion and ending work. Add a busy-state submission and one controlled restart only within this dedicated test; never replay old unknown messages. Stop on blocked organization policy, unavailable authentication, account restriction, or missing channel events. Do not edit policy or bypass restrictions. Close this test session and verify its own service exits.

This live test has NOT been started and the channel consent has NOT been accepted. The remaining request is permission for this dedicated interactive development-channel validation with the existing configured model capability; any terminal consent/approval is for the user to accept. No request for a new key, organization change or persistent MCP connection is made.

For ordinary use, run `/absolute/path/to/polish-axi/dist/polish-claude` from the desired project, then `/polish /absolute/path/artifact.html`. A running session started without Channels cannot be retrofitted by typing a skill alone. Resume an intended stopped session with `--resume <id>`; do not duplicate an active session. Terminal final text is not automatically scraped: the model must use the reply tool. Browser script-close restrictions and safe unknown outcomes remain explicit.

## Build identity (SHA256)

- `dist/claude-channel.mjs`: `99856e74ece1fef42c58fb63bfa26103642b1d0c7a6ba286ca7838df21e80b46`
- `dist/polish-claude`: `bce2f57e1a570e5e9eaf241c38f3b066364ccf0e248ac75a71df446583393951`
- `dist/pi-extension.mjs`: `a9201b9411fed3103dc1b6183f53c7ac735fc3e5bd43c09e8a4744a6745cad79`
- `dist/polish`: `984aa57b601634268dcd1ec01b94fec0382b0b9f22b671fecc7435825dd19961`
- `dist/chrome-client.js`: `ec5f4becf0e212b6d035df8a466cda12c3419dd0ab68821065b60f6eb846da08`
- `dist/polish-client.js`: `0168b4c28611e57c85501932e2bf52adaf09a2f8f12e3743037f03ef15b65b84`
- `dist/polish.css`: `75dbd3cef9c1ad235a4fdf463b56b413d6c193879db53d28d5c3c9d3db9faf81`
- `dist/server.mjs`: `93e5aff4c7b0713ea052f27a4a414aa77e18f22fade5bc6e6c5298f1c0d34cab`
- `dist/cli.mjs`: `4b0b573cc03de36f382f9a1ec067d77e567d0d90ddf6ccce208198f6e862b8ea`
- `src/claude-host.js`: `617232939840dfd5fdaa1ce92f5b9739e96511ab4687742bd09c8447ecc67557`
- `src/claude-channel.js`: `7ba8529bec64ea07110f656bfee0307225e27a8dda5bbe4beeb9ad9c446b66f7`
- `src/claude-launch.js`: `819475a0394b711ae9ea4f8e9378967130e8170bf898d47794ea416447049574`
- `pnpm-lock.yaml`: `c779bc60d4e784c31710e722a2eecc4e87092a3e38d1b9246f2d5d437acbd34b`
