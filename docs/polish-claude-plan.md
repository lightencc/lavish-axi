> Superseded for the default workflow: the user selected the original Lavish skill/CLI/poll path. This document records the optional experimental Channels implementation only; it is not an installation requirement. See README.

# Claude Code adapter: implementation and acceptance

Status: implementation and isolated integration checks complete; real Claude acceptance is not established. See [validation](polish-claude-validation.md) for results, limitations and the prepared live-test scope.

Keep Pi and the existing page/store. A dedicated Claude-spawned stdio MCP channel owns one current Claude session. The `/polish` skill supplies Claude's `${CLAUDE_SESSION_ID}` substitution to `open_review`; the process refuses another session identity. Nothing attaches to Herdr sockets, reads unrelated transcripts, spawns `claude -p`, or replaces the conversation. A separate Claude plugin package uses `.claude-plugin/plugin.json`; the existing root Agent Plugins manifest stays intact.

The channel persists admission and a one-time dispatch intention before sending a notification. Successful transport write is only queued, never consumed. A notification-only receipt challenge, exact message identity, and a `consume_feedback` tool call prove that the channel consumer has observed the message. A separate `reply_feedback` tool persists the exact reply; it is not automatic terminal-final-answer capture. Browser routes cannot mint either receipt. Only local same-origin submissions reach the existing page; no permission relay is exposed.

Recovery preserves instance, session, original claim and port. Accepted but undispatched messages can first-dispatch. Dispatched messages with no consumer witness remain unknown and are never automatically resent. Consumed messages interrupted before reply remain execution-unknown. Exact tool retries are idempotent, conflicting replies fail. All dispatch serializes on consumption, independently of model replies, so ending's fixed final batch plus marker can drain without model completion. Unknown/unconsumed inputs still block dispatch. Restart cannot transfer state to another Claude session.

Acceptance gates:

1. Protocol tests: valid MCP initialize/tools/channel notification over stdio, bounded inputs and orderly transport shutdown; no model credentials needed.
2. Host tests: durable admit/dispatch/consume/reply; forged or conflicting identities rejected; concurrent/duplicate calls; restart and unknown windows; exclusive ownership.
3. Real product HTTP + isolated MCP client: open HTML, submit, receive event, consume, reply, query, end, recover and release resources. This proves integration with the protocol, not real Claude behavior.
4. Pi regression, full project checks and package freshness.
5. Real dedicated interactive Claude session: `/polish`, binding verified against actual session, idle wake and busy queue, real receipt/reply tools, webpage state, interruption/ending and cleanup. Requires an authorized authentication provider, Channels support and explicit local development-channel confirmation. If unavailable, label this gate untested, not passed.

Herdr is a launcher, not a transport: it must preserve the channel and skill launch arguments. Its existing taskforge-mvp session is not a test target. Persistent MCP installation, authentication changes, organization controls and security changes are outside the current authorization.

Official references checked 2026-10-31:

- https://code.claude.com/docs/en/channels
- https://code.claude.com/docs/en/channels-reference
- https://code.claude.com/docs/en/skills (current-session substitution)
- https://code.claude.com/docs/en/plugins-reference (separate Claude manifest)

Channels remain a research preview. Notifications have no host consumption acknowledgement; custom development channels require an interactive opt-in and remain subject to organization policy. Use explicit acknowledgement tools and preserve uncertainty rather than treating notification success as proof.
