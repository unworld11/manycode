# Changelog

ccshare installs and updates straight from git (`ccshare update` is a `git pull`),
so what you actually run is `master` HEAD - these tags just mark the points worth
naming.

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
