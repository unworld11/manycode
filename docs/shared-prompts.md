# Shared prompting

Start an invited shared agent session in the project you want to work on:

```sh
manycode host --task "Work together" --detach
manycode task open
```

Share the join code or the printed browser URL with a teammate. Do not share the
owner URL opened by task open: its token grants owner controls. Both people can
use **Send prompt** in the task panel. No handoff is required. Everyone sees the
same live terminal output, including prompts, agent answers and tool activity.
The prompt history records who submitted each prompt and whether it is queued,
sent, or failed. Raw terminal control remains limited to the current driver.

Terminal joiners can press Ctrl-T and enter `/prompt your question`.
`/instruct` remains an alias. The native Mac Task panel has the same composer.
Viewers cannot submit; read-only sessions also reject contributor prompts.

Before sending shared prompts, finish the agent's startup dialogs (such as folder
trust) in the host terminal. Prompts are real terminal input and can otherwise
activate a startup menu instead of reaching the conversation. The Codex test uses
`-c check_for_update_on_startup=false` for its invocation to avoid the update menu.

## Delivery semantics

The host serializes accepted prompts. Text entry and Enter are separate PTY
writes because Claude Code treats a combined write as pasted text. Raw input is
blocked during those writes so keystrokes cannot interleave with submission.
Use the composer rather than leaving a partially typed raw-terminal draft.

Sent means submitted to the terminal. Manycode does not infer that the agent
finished answering. The running agent controls its own handling of busy input.
The queue holds at most 32 waiting prompts, and the journal retains 200 prompts.
Duplicate request IDs from the same participant are suppressed within that
retained history. Disconnected or demoted senders lose queued prompt delivery.
On restart, interrupted delivery is marked failed and never replayed automatically;
check the agent before resubmitting because a crash can leave delivery uncertain.
Review cannot begin while a prompt is queued or being submitted.

## Verified behavior

- Codex CLI 0.158.0: two independent browser profiles exchanged three prompts;
  Bob recalled Alice's codename and Alice continued afterward. Both profiles saw
  all replies with no handoff. Tested after completing startup folder trust.

- Two real Claude Code participants: Alice supplied a room word; Bob asked about
  it from a separate socket; the same Claude conversation remembered it and both
  clients received the answer without a handoff. No tools or hooks were enabled
  for this test, and only synthetic text in an empty temporary project was used.
- Automated real-PTY tests: simultaneous contributors, FIFO submission, stamped
  authors, duplicate suppression, viewer/read-only rejection, revoked queued
  access, failed writes, bounded queue, and review gating.
- Isolated browser test: two-person prompting, shared output/history, contributor
  and viewer controls, suggestions, review/completion, late joining, mobile layout.
- Native Swift UI compiles; full native-window interaction was not exercised here.

This shares an agent launched through Manycode. It does not attach to arbitrary
existing ChatGPT chats or expose participants' unrelated private conversations.
