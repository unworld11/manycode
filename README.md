# ccshare - multiplayer Claude Code

**[getccshare.vercel.app](https://getccshare.vercel.app)**

Share your live Claude Code session with friends using a short code, AirDrop-style.
The host runs your agent in a PTY and mirrors the terminal; everyone who joins sees
the same screen and (unless you say otherwise) can type into the same session. Works
in both directions - you host and they join, or they host and you join.

Claude Code is the default, but any terminal agent works - name it after `host`:

```sh
ccshare host              # claude
ccshare host codex        # openai codex cli
ccshare host opencode     # opencode
ccshare host kimi         # kimi cli
ccshare host aider --model gpt-5   # args pass straight through
```

## Install (and update)

```sh
curl -fsSL https://getccshare.vercel.app/install.sh | sh
```

One command for everything: fresh install, and re-run it any time to update (it
clones to `~/ccshare`, or hard-updates the existing clone when it's clean). Prefer
doing it by hand? `git clone`, `npm i`, `npm link` works too - and `ccshare update`
pulls the latest once you're installed. If `ccshare` isn't found after `npm link`
(homebrew's node links into the Cellar, which isn't on PATH), the installer handles
it; manually it's `ln -sf "$PWD/bin/ccshare.js" /opt/homebrew/bin/ccshare`.

Then run `ccshare setup` (or just `ccshare host` - it onboards you the first time):
a 30-second interactive wizard that asks your display name, detects which coding
agents you have installed and sets your default, and picks tunnel + menu bar
preferences. Everything lands in `~/.ccshare/config.json`; per-session flags always
win over it, and rerunning `ccshare setup` changes it any time.

node-pty ships prebuilt binaries, but npm strips the exec bit off its
`spawn-helper` - the postinstall script in this package restores it. If claude
ever fails to start with `posix_spawnp failed`, run `npm rebuild` here.

## Same Wi-Fi (the AirDrop case)

```sh
# you, in your project directory
ccshare host
#   code:  7KQ 2FM

# your friend, anywhere on the same network
ccshare join 7KQ2FM
```

Discovery is a UDP broadcast carrying a hash of the code, so `join` finds the host
automatically - no IPs. `Ctrl-]` detaches a joiner without touching the session.

## Different networks

Three options, easiest first:

- **Tunnel (on by default):** hosting opens a free Cloudflare quick tunnel in the
  background - `cloudflared` comes bundled via npm, so there is nothing to install
  and no account needed. A few seconds later the remote join command - like
  `ccshare join 7KQ2FM --host wss://random-words.trycloudflare.com` - appears in the
  menu bar ("copy remote join command") and in `ccshare code`. That command works
  from any network. The URL is random, unguessable, and dies with your session.
  `--tunnel` waits at startup so the link prints in the banner instead;
  `--no-tunnel` keeps the session off the internet entirely. Join falls back to
  resolving fresh tunnel hostnames via 1.1.1.1 when the OS resolver has a stale
  negative answer.

  Note for friends who cloned early: joining a `wss://` URL needs the current
  version, so have them `git pull` in their ccshare checkout.
- **Tailscale (or any reachable IP):** the host banner prints a direct line like
  `ccshare join 7KQ2FM --host 192.168.1.4:42518` - swap in the tailnet IP and it
  connects straight through, no extra server.
- **Relay:** one of you runs `ccshare relay` on any box with a public address
  (a $0 Fly/Railway/Render instance works - it respects `PORT`). Then everyone puts
  `export CCSHARE_RELAY=wss://your-relay` in their shell profile. With that set,
  `ccshare host` registers with the relay automatically and `ccshare join CODE`
  falls back to it when LAN discovery finds nothing. The relay is a dumb pipe; it
  never sees your code in plaintext discovery, just relays frames for paired rooms.

## The code scrolled away?

Claude's UI takes over the screen right after the banner, so two things bring the
code back:

- **macOS menu bar** - hosting auto-starts a tiny status bar helper showing your live
  code. Click it to copy the code or the whole join command, see who's connected, and
  get a notification when a friend joins. It compiles itself from
  `menubar/menubar.swift` on first run (needs the Xcode command line tools) and quits
  when your sessions end. `ccshare host --no-menubar` opts out; `ccshare menubar`
  starts it by hand and keeps it running.
- **`ccshare code`** - prints the code, project, and joiner list for every active
  session, on any platform.

## Useful flags

- `ccshare host --read-only` - friends can watch but not type.
- `ccshare host -- --resume` - everything after `--` goes to claude itself.
- `ccshare host <anything>` - share any terminal program, agents or otherwise.
- `ccshare join CODE --name dev-priya` - how you appear on the host's side.
- `ccshare host --max 2` - cap joiners (default 5).

## How it behaves

- The PTY runs at the smallest connected terminal, tmux-style, so everyone sees the
  same frame. When someone joins, resize + a repaint jiggle gives them a fresh screen;
  they also get the recent scrollback (last 256KB) replayed.
- New joiners ring a bell on the host and the terminal title shows `ccshare CODE · N connected`.
- The session dies when claude exits on the host; joiners are told and dropped.

## Security, plainly

The code is the only auth, and anyone who has it can type into a real terminal on the
host's machine - that means running arbitrary commands. Only share codes with people
you'd hand your laptop to. Codes die with the session, direct/LAN traffic is plain
`ws://` on your local network, and the relay sees terminal bytes, so put the relay
behind TLS (`wss://`) if you deploy one.
