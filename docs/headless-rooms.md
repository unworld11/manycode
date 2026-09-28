# Manycode shared rooms: proposal

Status: design only; no backend deployed or client connector implemented.

People keep using their own agent. A room stores the shared goal, explicit
messages, decisions, artifacts, assignments and handoffs. Private conversations
stay private unless participants explicitly publish selected content.

Example: a founder in ChatGPT posts a pricing requirement to room checkout.
An engineer's Claude Code retrieves it, edits the repository and publishes a
patch and test results. A second engineer reviews the exact patch from their
own Claude Code. The founder asks ChatGPT for the room's current status.

## First version

Use a remote MCP service over HTTPS with per-user OAuth and room membership.
Tools: create_room, join_room, get_updates(cursor), post_message, claim_task,
publish_artifact, request_review, handoff_task. Joining requires an invitation;
knowing a room name does not grant access. Author identity comes from auth.

Postgres holds rooms, members, tasks, task leases, append-only events and per-client
cursors. Store large artifacts separately with room-scoped access. Every mutation
has an idempotency key. Revision checks reject stale handoffs and reviews. One
active executor owns a task lease; other agents can comment or work on separate
tasks. Do not broadcast each model response to every agent: explicit recipients
and bounded notifications prevent reply loops and repeated token spend.

Start with two Claude Code clients sharing a room through ordinary MCP tools.
Polling get_updates is the portable baseline. An opt-in Claude channel adapter
can deliver live events where supported. Channels are a research preview and
custom-channel rollout restrictions need verification before promising a normal
one-command installation. Offline clients catch up from durable cursors.

ChatGPT uses a custom remote MCP app where supported. Current OpenAI help lists
full MCP for Business/Enterprise/Edu on web, with more limited Pro support and
no mobile support for this path. Validate intended account/client before rollout.
Do not promise arbitrary injection into existing ChatGPT chats, passive transcript
access, or background execution merely because an MCP server is connected.

The backend coordinates tasks. Execution stays in a participant's local session
at first. If work must continue with all laptops asleep, add an explicitly hosted
worker with its own compute and provider authentication; a shared database alone
cannot keep a local agent running. Existing task journal, roles, review revisions
and relay behavior provide design inputs, but local file locks must become database
transactions and leases for multiple backend instances.

## Acceptance demo

Two separately authenticated users join an invite-only room. A third cannot read
or write it. User A posts a task, B claims and publishes a result, A reviews the
exact revision. Restart a client and recover unread events without duplicate work.
Retry a mutation and observe one event. Race two claims and observe one winner.
Disconnect an executor and recover its expired lease without accepting stale writes.
Then exercise a supported ChatGPT account against the same room. No native UI needed.

## References checked

- https://code.claude.com/docs/en/mcp
- https://code.claude.com/docs/en/channels
- https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
