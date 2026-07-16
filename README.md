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
