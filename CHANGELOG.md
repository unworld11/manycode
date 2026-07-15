# Changelog

ccshare installs and updates straight from git (`ccshare update` is a `git pull`),
so what you actually run is `master` HEAD - these tags just mark the points worth
naming.

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
