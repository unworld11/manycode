# Changelog

manycode installs and updates straight from git (`manycode update` is a `git pull`),
so what you actually run is `master` HEAD - these tags just mark the points worth
naming.

## 0.5.0

- **Talk on the side.** Every session now has a chat channel that never touches
  the shared prompt - coordinate who's driving without typing over each other.
  Browser joiners get a sidebar with an unread badge, CLI joiners press `Ctrl-T`
  to compose (Enter sends, Esc cancels), and the host chats from any terminal
  with `manycode say "…"` plus macOS notifications for incoming messages. Late
  joiners get recent chat replayed; sender names are stamped by the host.
- **.env values don't leak by default.** Hosting a folder with `.env` files asks
  what joiners should see. The default masks every value with `••••••` in the
  live stream, the scrollback replay, and recordings - even when a secret is
  split across output chunks - while the host's own screen stays raw.
  `--share-secrets` opts into sharing, `--redact-secrets` skips the question.

## 0.4.0

- **ccshare is now manycode.** Same tool, wider name - it was never only about
  Claude Code, and the sessions were never only two people. Nothing breaks:
  the `ccshare` command keeps working as an alias, `~/.ccshare` migrates to
  `~/.manycode` automatically on first run, `CCSHARE_*` environment variables
  are still honored (`MANYCODE_*` is the new spelling), the github repo
  redirects from the old URL, and existing installs update in place - this very
  update notice is proof.

## 0.3.1

- **The menu bar shows tunnel progress.** "open anywhere link" used to flash
  "opening…" for a second and then look exactly like before while cloudflared
  took its 5-20 seconds. Now the row turns into a live "opening anywhere link…"
  state until the link is up (including the default background tunnel at
  startup), you get a notification when it's ready or when it gives up, and
  `ccshare code` prints "anywhere: link opening…" in the meantime.
- **Copy the anywhere link in two shapes.** Once the tunnel is live the menu
  offers "copy anywhere join command" (the full `ccshare join …` line) and
  "copy anywhere terminal link" (just the wss:// url), alongside the browser
  link.
- **`ccshare update` explains itself.** It now prints the version you went from
  and to, echoes the changelog headlines for every version you crossed, and
  gives specific fixes when you're offline, have local changes, or your clone
  diverged - instead of raw git/npm output that ended in an ambiguous "up to
  date" even when it did just update you.

## 0.3.0

- **Join from a browser.** The host now serves an xterm.js terminal page on its
  session port, so the tunnel URL doubles as a no-install join link:
  `https://random-words.trycloudflare.com/#CODE` (or `http://lan-ip:port/#CODE` on
  the same network). Full live terminal in the browser - phone included - same
  replay, typing, and resize behavior as the CLI joiner. The link shows in the
  banner, the menu bar, and `ccshare code`.
- **`ccshare host --approve`.** Each joiner waits until you click Allow in a macOS
  dialog; deny and they're told the host declined. Enforced for direct/LAN/tunnel
  joiners (their input is dropped until admitted), best-effort over a relay (input
  frames there aren't attributed per joiner). `ccshare setup` can make it the
  default; `--no-approve` skips it per session.
- **`ccshare host --record`.** Saves the session as an asciinema v2 `.cast` file in
  the project directory (output and resizes, timestamped). Writes are synchronous
  appends, so even a SIGTERM keeps the tail.
- **Menu bar, rounder.** Copy-browser-link row; "open anywhere link" starts the
  tunnel on a lan-only session right from the menu; "end session" stops a host
  cleanly (same path as `ccshare stop`); the status title shows how many friends
  are connected; copying flashes "copied ✓"; you get a notification when someone
  leaves (with their name), not just when they join; recording and view-only
  sessions are labeled.

## 0.2.0

- **Slow joiners can't balloon host memory anymore.** Output for each joiner is
  buffered in the host until their socket drains; a joiner that stops reading (dead
  tunnel, backgrounded tab, weak wifi) used to grow that buffer without bound. Now a
  socket that falls ~8MB behind is dropped - the host prints who was dropped, and
  they can rejoin for a fresh replay. It's a clean disconnect, not a silent
  byte-skip - skipping bytes mid-escape-sequence would leave the screen corrupted
  with no way back. The relay got the same guard for its broadcast path.
- **`ccshare stop` won't kill a stranger.** If a host died hard and the OS recycled
  its pid, the stale session entry could have pointed `stop` at an unrelated process;
  it now verifies the pid is actually ccshare before signaling.
- **`ccshare stop [code]`** ends a running host session from another terminal, so you
  no longer have to switch back to the hosting window to Ctrl-C it. With no code it
  stops the only session; with several running it names them so you can pick one.
- **`ccshare version`** (also `--version` / `-v`) prints the installed version and
  commit.
- **Stopping a host restores its terminal.** `ccshare stop`, a closed terminal, or any
  SIGTERM/SIGHUP now takes the host's tty out of raw mode and brings the cursor back
  before exiting, instead of leaving that terminal wedged.

## 0.1.0

First public release. Host a live Claude Code (or codex/opencode/kimi/aider…) session
behind a short code, join it from the same wifi via UDP discovery, from another network
via a bundled Cloudflare quick tunnel, or through a self-hosted relay. macOS menu bar
helper, `ccshare code`, interactive `ccshare setup` onboarding, and a `curl | sh`
installer that doubles as the updater.
