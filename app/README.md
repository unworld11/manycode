# manycode.app — native macOS client

A SwiftUI app that speaks the same manycode wire protocol as the CLI joiner and
the browser page. It renders the live terminal with [SwiftTerm](https://github.com/migueldeicaza/SwiftTerm),
puts chat in a native sidebar, and hosting spawns the installed CLI engine
headless and joins its own session on localhost — so one protocol serves every
client and nothing about the CLI has to change.

## Build and run

```sh
cd app
swift run          # or: swift build && .build/debug/Manycode
```

Needs the Swift toolchain (Xcode command line tools) and the `manycode` CLI on
PATH for the "Host a folder" flow. `swift run` fetches SwiftTerm on first build.

## Design

Implements design A (terminal green) from the Claude Design project:

- **Host** — start a session in a folder, or rejoin one already running here
- **Join** — 6-box code entry with LAN discovery
- **Session** — live SwiftTerm terminal + a People / Messages rail, code pill,
  Invite sheet (code hero + join commands), End / Leave
- **Messages** — room chat that never touches the shared prompt
- **Recordings**, **Settings** — session `.cast` files and shared CLI config

## Not yet

Ships as a plain SwiftPM binary. A signed, notarized `.app` bundle (and an
auto-updating distribution) is the next step before this goes to users.
