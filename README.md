# manycode - multiplayer coding agents

**[manycode.vercel.app](https://manycode.vercel.app)**

[![installs](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Funworld11%2Fmanycode%2Ftraffic%2Fbadge.json&style=flat)](https://manycode.vercel.app)
[![GitHub stars](https://img.shields.io/github/stars/unworld11/manycode?style=flat&color=d97757&label=stars)](https://github.com/unworld11/manycode/stargazers)
[![latest release](https://img.shields.io/github/v/release/unworld11/manycode?style=flat&color=86c48e&label=release)](https://github.com/unworld11/manycode/releases)
[![license](https://img.shields.io/github/license/unworld11/manycode?style=flat&color=8a94a0)](LICENSE)
[![Product Hunt](https://img.shields.io/badge/Product%20Hunt-ccshare-da552f?style=flat)](https://www.producthunt.com/products/ccshare)

> manycode was called **ccshare** until July 2026 - same tool, wider name. The
> `ccshare` command keeps working, and existing installs update in place.

Share your live Claude Code session with friends using a short code, AirDrop-style.
The host runs your agent in a PTY and mirrors the terminal; everyone who joins sees
the same screen and (unless you say otherwise) can type into the same session. Works
in both directions - you host and they join, or they host and you join.

Claude Code is the default, but any terminal agent works - name it after `host`:

```sh
manycode host              # claude
manycode host codex        # openai codex cli
manycode host opencode     # opencode
manycode host kimi         # kimi cli
manycode host aider --model gpt-5   # args pass straight through
```

## CLI and agent setup

From a checkout: `npm install && npm link`, then `manycode setup`.
Setup installs the `manycode-setup` skill for Codex and Claude Code before
opening the preferences wizard. For automated installs:

```sh
manycode setup --skills-only
manycode doctor
```

Start a new Codex or Claude Code session and say:
**Use manycode-setup to configure Manycode and start a shared coding session.**
The curl installer also installs this skill. Releases include a standalone CLI
package at https://github.com/unworld11/manycode/releases.

To prepare a ChatGPT desktop SSH connection to a server you already use:

```sh
manycode setup --ssh-host your-server.example --ssh-user your-user --ssh-identity ~/.ssh/your-key --ssh-alias manycode
manycode doctor --ssh manycode
```

The CLI maintains a marked entry in `~/.ssh/config`, preserves other entries,
and saves the original as `~/.ssh/config.before-manycode` on its first change.
It uses an existing key; server provisioning and key authorization remain separate.
The SSH check requires a trusted host key and `codex` on the remote login shell's
PATH. Authenticate Codex on that host before using it in the desktop app.
Then select **manycode** in ChatGPT **Settings → Connections → SSH** and choose
a project. `CODEX_HOME` and `CLAUDE_CONFIG_DIR` override skill install locations.

To share a selected existing Codex/ChatGPT desktop chat:

```sh
codex app-server daemon start
manycode share-thread --name "Chosen chat title" --guest-name Bob --tunnel
```

Keep the selected chat open. Manycode reads only that thread through the app-server
API and queues guest prompts; the owning app processes them when ready. It does
not resume the thread in a competing backend. Both backends need message-queue
support. `--thread ID` selects an exact thread; `--socket PATH` selects a control
socket. Without `--tunnel`, the invite page listens only on localhost.

Guests receive live updates containing changed turns, with immediate feedback on submitted prompts. The desktop backend may still take up to ten seconds to pick up queued prompts before model processing starts.

The contributor invite permits reading and prompting. The view-only invite permits
reading. These are bearer links, not account logins. Ctrl-C revokes future access
and closes the tunnel; already queued prompts remain queued. Approvals stay with
the host. User and assistant text and tool summaries are shared; internal reasoning
and system/developer instructions are omitted. Conversation text can contain
sensitive information: choose the thread you intend to share.

To join through your own Codex or Claude Code session, ask its agent to use the
`manycode-setup` skill with the invite link. The guest bridge supports
`manycode remote connect "INVITE_URL"`, `manycode remote read`, and
`manycode remote prompt "Your message"`. It stores the invite privately on your
machine; `manycode remote disconnect` removes it. This is tool-mediated access
from your own chat, not native mirroring of the host's thread.

SSH setup remains a separate option for remote project connections. The Claude
skill targets Claude Code; it does not attach to Claude desktop chats.

`npm run test:desktop -- --tunnel` exercises separate backends and browser contexts
using synthetic data. Visible ChatGPT UI confirmation is a separate manual check.

## Shared tasks: work together across handoffs

Create a task in the project you want the agent to work on:

```sh
manycode host --task "Build checkout" --detach
manycode task open
```

`task open` opens local host controls in your browser. Share the ordinary browser
link or session code with teammates. The host controls link includes a private
owner token; it is removed from the address bar after loading and is never part of
the ordinary invite. CLI sessions without `--task` retain the existing everyone-can-type behavior.
The macOS app's **Host a folder** flow creates a task automatically.

Each shared task has a goal, plan, optional preview link, live terminal, feedback,
people, activity history, and Git review. The browser and macOS **Task** panels
use the same host-enforced protocol.

- **Shared prompts.** Contributors and reviewers can use **Send prompt** without
  a control handoff. Everyone sees the attributed prompt history and the same live
  agent terminal, including responses and tool activity. Prompts enter a bounded
  FIFO queue; sent means delivered to the terminal, not a completed AI response.
  The agent decides how to handle input while busy. Failed deliveries stay visible
  and are not retried automatically. Use the composer for shared prompts rather
  than mixing them with partially typed raw terminal input.
- **One raw-terminal driver.** The host starts with control. Teammates request it; the current
  driver or host hands it to a connected participant. Host terminal input is also
  blocked while someone else drives. If the driver disconnects, control returns
  to the host, who can recover it through `manycode task open`.
- **Suggestions and instructions are separate.** Attach feedback to a `file:line`,
  preview, or decision. The driver accepts or declines it. Accepting a suggestion
  never submits it to the agent; **Send prompt** is a separate, attributed action available to contributors.
- **Roles.** Joiners start as contributors. Only the host can assign viewer,
  contributor, or reviewer roles. Viewers can inspect the task and diff but cannot
  change the task or request control. Roles apply to the current connection;
  reconnecting creates a new contributor identity and requires fresh review privileges.
- **Catch-up.** Late joiners get the current brief, feedback decisions, approvals,
  the latest 200 prompts, and the latest 100 recorded events. The browser highlights updates since that
  browser's last visit. The native panel shows the five latest events. This is a
  summary of recorded actions, not an AI interpretation of terminal output.
- **Review.** Resolve open feedback, then request review. Refresh the Git diff
  before approving. Only a designated reviewer or the host can approve. Completion
  requires an approval matching the current HEAD and tracked working-tree diff.
  Changed files invalidate an attempted completion; request a fresh review. Stage
  or ignore untracked files first. Review/complete states block new human input,
  but do not pause an already-running agent. These approvals do not merge, deploy,
  or intercept commands the agent executes itself.
- **Preview.** The task links to an existing HTTP(S) preview. Use an address your
  teammates can reach; Manycode does not publish or proxy your development server.

`--detach` keeps the host and its agent running after the launching terminal exits.
Closing a browser or choosing **Leave running** in the macOS app also leaves the
host alive. The machine must remain awake and online. This is host-backed execution,
not cloud hosting or automatic failover. Use `manycode stop CODE` to end it.

Tasks are saved under `~/.manycode/tasks/` with owner-only file permissions and
atomic writes. This directory contains the task brief, feedback, and recorded
instructions, so treat it as project data. Raw keystrokes and complete terminal
output are not part of the task journal; use `--record` for a terminal recording.
Existing `.env` redaction also applies to shared task text and diffs. It only masks
values discovered at startup, as described below.

```sh
manycode tasks                         # saved tasks, status, live codes
manycode task show --code ABC123        # current task, people IDs, recent events
manycode task update --goal "Handle failed payments" --code ABC123
manycode task handoff --target d2 --code ABC123
manycode task role --target d2 --role reviewer --code ABC123
manycode task changes --code ABC123

# After the host has stopped, in the same project directory:
manycode host --resume-task TASK_ID --detach
# To also resume Claude's own conversation, pass its resume argument:
manycode host --resume-task TASK_ID --detach -- --resume
```

Resuming restores the task journal and brief, marks undelivered prompts failed
without replaying them, resets review approvals, and starts
an agent process. Provider conversation recovery depends on that agent's resume
options; Manycode does not restore a crashed PTY. A lock prevents two live hosts
from writing the same task. Task discovery is local to the host account; remote
teammates join a specific task by its code. There is no organization directory or
account-based project membership in this version.

CLI joiners can use `Ctrl-T` with `/control`, `/handoff ID`, `/suggest TEXT`,
`/instruct TEXT`, `/review`, `/working`, `/approve HASH`, or `/complete HASH`.
Use the browser for the full task brief and diff. `manycode task` commands are
local host controls, with `--code` selecting among multiple live tasks.

Task sessions require an updated relay. They refuse older relays without sender
identity support and continue with direct/LAN hosting. Updated relays stamp input
identity and withhold task-session output until the host admits the joiner.

## Development checks

```sh
npm ci
npm test                     # existing flows + task/relay/persistence tests
npm run test:browser          # isolated two-person browser flow + mobile screenshots
cd app && swift build
```

Browser tests use fresh, headless profiles against a temporary local Git project.
They use installed Chrome on macOS, `BROWSER_EXECUTABLE` when provided, or a
Playwright Chromium installed with `npx playwright install chromium`. External
network requests are blocked during the UI test; terminal assets are served locally.
`MANYCODE_STATE_DIR` isolates task/config/session files for tests.

On an Xcode installation without the Metal toolchain, `swift build --build-system
native` builds SwiftTerm using its bundled shader source. Swift marks that build
system deprecated; installing the Metal toolchain enables the default build path.

## Publishing Mac releases

`npm run dist:mac` builds an ad-hoc signed universal app, DMG,
and ZIP without an Apple Developer ID certificate. `npm run verify:release` checks the packaged downloads, and
`npm run publish:release` uploads a draft, verifies the downloaded bytes, then
makes that version latest. These releases are not notarized; first launch may
require Privacy & Security > Open Anyway.
The native app's **Check for Updates** menu opens new release downloads without
replacing an app during live work.

See [macOS release setup](app/NOTARIZE.md) for GitHub Actions, versioning,
installation instructions, and optional notarization.

## Install (and update)

```sh
curl -fsSL https://manycode.vercel.app/install.sh | sh
```

One command for everything: fresh install, and re-run it any time to update (it
clones to `~/manycode`, or hard-updates the existing clone when it's clean). Prefer
doing it by hand? `git clone`, `npm i`, `npm link` works too - and `manycode update`
pulls the latest once you're installed. If `manycode` isn't found after `npm link`
(homebrew's node links into the Cellar, which isn't on PATH), the installer handles
it; manually it's `ln -sf "$PWD/bin/manycode.js" /opt/homebrew/bin/manycode`.

Then run `manycode setup` (or just `manycode host` - it onboards you the first time):
a 30-second interactive wizard that asks your display name, detects which coding
agents you have installed and sets your default, and picks tunnel + menu bar
preferences. Everything lands in `~/.manycode/config.json`; per-session flags always
win over it, and rerunning `manycode setup` changes it any time.

node-pty ships prebuilt binaries, but npm strips the exec bit off its
`spawn-helper` - the postinstall script in this package restores it. If claude
ever fails to start with `posix_spawnp failed`, run `npm rebuild` here.

## Same Wi-Fi (the AirDrop case)

```sh
# you, in your project directory
manycode host
#   code:  7KQ 2FM

# your friend, anywhere on the same network
manycode join 7KQ2FM
```

Discovery is a UDP broadcast carrying a hash of the code, so `join` finds the host
automatically - no IPs. `Ctrl-]` detaches a joiner without touching the session.

## Different networks

Three options, easiest first:

- **Tunnel (on by default):** hosting opens a free Cloudflare quick tunnel in the
  background - `cloudflared` comes bundled via npm, so there is nothing to install
  and no account needed. A few seconds later the remote join command - like
  `manycode join 7KQ2FM --host wss://random-words.trycloudflare.com` - appears in the
  menu bar ("copy remote join command") and in `manycode code`. That command works
  from any network. The URL is random, unguessable, and dies with your session.
  `--tunnel` waits at startup so the link prints in the banner instead;
  `--no-tunnel` keeps the session off the internet entirely. Join falls back to
  resolving fresh tunnel hostnames via 1.1.1.1 when the OS resolver has a stale
  negative answer.

  Note for friends who cloned early: joining a `wss://` URL needs the current
  version, so have them `git pull` in their manycode checkout.

- **Tailscale (or any reachable IP):** the host banner prints a direct line like
  `manycode join 7KQ2FM --host 192.168.1.4:42518` - swap in the tailnet IP and it
  connects straight through, no extra server.
- **Relay:** one of you runs `manycode relay` on any box with a public address
  (a $0 Fly/Railway/Render instance works - it respects `PORT`). Then everyone puts
  `export MANYCODE_RELAY=wss://your-relay` in their shell profile. With that set,
  `manycode host` registers with the relay automatically and `manycode join CODE`
  falls back to it when LAN discovery finds nothing. The relay is a dumb pipe; it
  never sees your code in plaintext discovery, just relays frames for paired rooms.

## Join from a browser - nothing to install

The host also serves a terminal web page on the same port, so every session has a
browser link like `https://random-words.trycloudflare.com/#7KQ2FM` (or
`http://192.168.1.4:42518/#7KQ2FM` on the same network). Send it to a friend and
they're in the live session from any browser - phone included - with the code
prefilled; no git clone, no node, nothing. It's a full xterm.js terminal speaking
the same protocol as the CLI joiner, so they see the same screen and can type
unless the session is `--read-only`. The link shows in the host banner, the menu
bar ("copy browser link"), and `manycode code`.

## The code scrolled away?

Claude's UI takes over the screen right after the banner, so two things bring the
code back:

- **macOS menu bar** - hosting auto-starts a tiny status bar helper showing your live
  code (and how many friends are on). Click it to copy the code, join commands, or
  the browser link; open the anywhere-tunnel on a lan-only session; end the session;
  and get notifications when friends join or leave. It compiles itself from
  `menubar/menubar.swift` on first run (needs the Xcode command line tools) and quits
  when your sessions end. `manycode host --no-menubar` opts out; `manycode menubar`
  starts it by hand and keeps it running.
- **`manycode code`** - prints the code, project, and joiner list for every active
  session, on any platform. `manycode stop [code]` ends a session from any terminal
  without switching back to the one hosting it.

## Group sessions and late invites

Up to 5 friends can be in one session (`--max` changes that); everyone sees the same
screen and everyone can type. Nobody has to be there at the start - the code works
for the whole session, and late joiners get the recent scrollback replayed plus a
fresh repaint. Started lan-only and now want someone remote? `manycode tunnel` opens
the anywhere-link on the running session and prints the join command - no restart.

## Talk on the side

Every session has a chat channel that never touches the shared prompt, so you can
sort out who's driving without typing over each other. In the browser it's a
sidebar with an unread badge; in the CLI, `Ctrl-T` opens a chat line (Enter sends,
Esc cancels); the host sends from any terminal with `manycode say "message"` and
gets a macOS notification when someone writes. Late joiners get the recent chat
replayed, and names are stamped by the host - nobody can impersonate anyone.

## Useful flags

- `manycode host --read-only` - friends can watch but not type.
- `manycode host --approve` - each joiner waits until you click Allow in a macOS
  dialog; `manycode setup` can make that the default, `--no-approve` skips it for
  one session.
- `manycode host --record` - saves the whole session as an asciinema `.cast` file
  in the project directory; play it back with `asciinema play` or upload it to
  asciinema.org.
- `manycode host --share-secrets` - hosting a folder with `.env` files asks
  what joiners should see; the default masks the values with `••••••` in the live
  stream, the scrollback replay, and recordings (your own screen stays raw).
  `--redact-secrets` skips the question, `--share-secrets` shares real values.
- `manycode host -- --resume` - everything after `--` goes to claude itself.
- `manycode host <anything>` - share any terminal program, agents or otherwise.
- `manycode join CODE --name dev-priya` - how you appear on the host's side.
- `manycode host --max 2` - cap joiners (default 5).

## How it behaves

- The PTY runs at the smallest connected terminal, tmux-style, so everyone sees the
  same frame. When someone joins, resize + a repaint jiggle gives them a fresh screen;
  they also get the recent scrollback (last 256KB) replayed.
- New joiners ring a bell on the host and the terminal title shows `manycode CODE · N connected`.
- The session dies when claude exits on the host; joiners are told and dropped.

## Security, plainly

The code is the only auth, and anyone who has it can type into a real terminal on the
host's machine - that means running arbitrary commands. Only share codes with people
you'd hand your laptop to. Codes die with the session, direct/LAN traffic is plain
`ws://` on your local network, and the relay sees terminal bytes, so put the relay
behind TLS (`wss://`) if you deploy one.

Hosting a folder that contains `.env` files masks their values in everything
joiners see (and in recordings) unless you explicitly `--share-secrets` - so a
stray `cat .env` on stream shows dots, not credentials. It's a literal byte match:
values also visible through some other encoding still leak, so treat it as a
seatbelt, not a vault.

`--approve` adds a second gate: a joiner with the right code still waits until you
click Allow. That's enforced by the host for direct, LAN, and tunnel joiners (their
input is dropped until admitted). Over a self-hosted relay it's best-effort - relay
input frames aren't attributed per joiner, so treat approval there as protection
against accidental joins, not hostile ones.
