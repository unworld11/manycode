---
name: manycode-setup
description: Install and configure the Manycode CLI, shared Codex or Claude Code terminal sessions, and ChatGPT desktop SSH connections. Use when asked to set up Manycode or share a coding agent conversation.
---
<!-- Managed by manycode setup -->

# Set up Manycode

Run `manycode --version` and `manycode --help` to establish which commands are installed. If missing or its help lacks `setup --skills-only`, install the released CLI:

```sh
npm install -g https://github.com/unworld11/manycode/releases/download/cli-v0.7.0/manycode-0.7.0.tgz
```

Node 18+, npm, and Git are prerequisites. For development, use the user's Manycode checkout with `npm install` and `npm link`. Verify the installed help before proceeding.

Run `manycode setup --skills-only`, then `manycode doctor`. Setup installs this skill into Codex and Claude Code using CODEX_HOME and CLAUDE_CONFIG_DIR when set. Start a new agent session to discover it.

## Shared conversations in Codex CLI or Claude Code

In the project the user selected, launch `manycode host --task "Shared work" codex` or `manycode host --task "Shared work" claude`. For an agent launching a background host, add `--detach`. The host prints the invite code and connection details. Give these to the user; send them to teammates only if asked.

Participants use `manycode join CODE` or the host's browser link. The shared prompt composer lets contributors prompt without taking terminal control. Verify with a disposable conversation: one participant sets a synthetic codename, the other asks for it, and both see the answer. Invite codes and participant names are not authenticated accounts.

## ChatGPT / Codex desktop SSH setup

This configures a remote project connection. Shared live desktop conversation attachment is not implemented yet; a successful SSH check is not multiplayer verification.

Collect the user's chosen SSH host, username, existing identity-file path, and optional port. Use these exact values in:

```sh
manycode setup --ssh-host HOST --ssh-user USER --ssh-identity /absolute/path/to/key --ssh-alias manycode
manycode doctor --ssh manycode
```

Setup maintains a marked block in ~/.ssh/config and preserves other entries. It does not provision a server, upload a key, or install remote Codex. The remote login shell must find an installed, authenticated `codex`. Doctor uses strict host-key checks; for a new host, have the user verify its fingerprint through their trusted server channel and establish SSH trust normally, then rerun doctor.

After doctor passes, have the user open ChatGPT Settings > Connections > SSH, select `manycode`, and choose the remote project. This UI step remains manual. Desktop connection instructions: https://learn.chatgpt.com/docs/remote-connections#connect-to-an-ssh-host

## Claude desktop

Installing this skill in ~/.claude/skills targets Claude Code. It does not connect arbitrary chats in the Claude desktop app or add an SSH settings panel there. For that request, explain the current boundary and offer a shared Claude Code session. Never describe skill installation as desktop multiplayer support.

## Completion

Report the installed CLI version, skill checks, optional SSH check, and the actual conversation test performed. On failure, show the specific failed check and repair that prerequisite before retrying. Keep desktop attachment unverified until both participants can see and prompt in the same desktop thread.
