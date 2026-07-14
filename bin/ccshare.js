#!/usr/bin/env node
'use strict';

const HELP = `ccshare - multiplayer claude code

  ccshare host [options] [-- <claude args>]
      share the claude session you're about to start. prints a join code.
      --relay <url>    also accept joiners through a relay (or set CCSHARE_RELAY)
      --no-relay       ignore CCSHARE_RELAY for this session
      --port <n>       websocket port for direct joiners (default 42518)
      --code <code>    pick your own code instead of a random one
      --read-only      joiners can watch but not type
      --max <n>        max simultaneous joiners (default 5)
      --cmd <bin>      run something other than 'claude'
      --tunnel         wait for the cloudflare tunnel at startup so the
                       banner shows the remote join link
      --no-tunnel      don't open a tunnel. tunnels are on by default
                       (cloudflared is bundled); the remote link appears
                       in the menu bar and 'ccshare code'
      --no-menubar     don't start the macOS menu bar helper
      -- <args>        everything after -- goes to claude (e.g. -- --resume)

  ccshare join <code> [options]
      attach to a friend's session. tries your local network first.
      --host <ip[:port]>  connect straight to the host (tailscale, port-forward)
      --relay <url>       fall back to this relay (or set CCSHARE_RELAY)
      --name <name>       how you show up on the host
      Ctrl-] detaches without stopping their session.

  ccshare relay [--port <n>]
      run a relay server so friends outside your network can join.
      default port 8787, or the PORT env var.

  ccshare code
      print the codes of your active sessions (the banner scrolls away
      once claude starts drawing; this gets them back).

  ccshare menubar
      start the macOS menu bar helper by hand. it stays until you quit it
      from the menu. hosting starts it automatically.

  ccshare update
      pull the latest ccshare from github and reinstall deps. host and
      join tell you when you're behind.

examples
  you:            cd my-project && ccshare host
  friend (wifi):  ccshare join 7KQ2FM
  friend (remote): ccshare join 7KQ2FM --relay wss://relay.example.com
`;

function die(msg) {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

function parseFlags(argv, spec) {
  // spec: { '--flag': 'key' } for booleans, { '--flag=': 'key' } for values
  const opts = {};
  const positional = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--') {
      opts.rest = argv.slice(i + 1);
      break;
    }
    if (spec[a + '='] !== undefined) {
      const v = argv[i + 1];
      if (v === undefined) die(`${a} needs a value`);
      opts[spec[a + '=']] = v;
      i += 2;
      continue;
    }
    if (spec[a] !== undefined) {
      opts[spec[a]] = true;
      i += 1;
      continue;
    }
    if (a.startsWith('--')) die(`unknown flag ${a}\n\n${HELP}`);
    positional.push(a);
    i += 1;
  }
  opts._ = positional;
  return opts;
}

const argv = process.argv.slice(2);
const cmd = argv.shift();

if (cmd === 'host') {
  const o = parseFlags(argv, {
    '--relay=': 'relay',
    '--no-relay': 'noRelay',
    '--port=': 'port',
    '--code=': 'code',
    '--read-only': 'readOnly',
    '--max=': 'max',
    '--cmd=': 'cmd',
    '--tunnel': 'tunnel',
    '--no-tunnel': 'noTunnel',
    '--no-menubar': 'noMenubar',
  });
  const relay = o.noRelay ? null : (o.relay || process.env.CCSHARE_RELAY || null);
  require('../lib/host').host({
    relay,
    port: o.port != null ? Number(o.port) : null,
    code: o.code,
    readOnly: !!o.readOnly,
    max: o.max ? Number(o.max) : undefined,
    cmd: o.cmd || 'claude',
    tunnel: !!o.tunnel,
    noTunnel: !!o.noTunnel,
    noMenubar: !!o.noMenubar,
    claudeArgs: o.rest || [],
  }).catch((e) => die('ccshare: ' + e.message));
} else if (cmd === 'join') {
  const o = parseFlags(argv, {
    '--host=': 'host',
    '--relay=': 'relay',
    '--name=': 'name',
  });
  const code = o._[0];
  if (!code) die('usage: ccshare join <CODE>\n\n' + HELP);
  require('../lib/join').join(code, {
    host: o.host,
    relay: o.relay || process.env.CCSHARE_RELAY || null,
    name: o.name,
  }).catch((e) => die('ccshare: ' + e.message));
} else if (cmd === 'relay') {
  const o = parseFlags(argv, { '--port=': 'port' });
  const port = Number(o.port || process.env.PORT || 8787);
  require('../lib/relay').startRelay(port);
} else if (cmd === 'code') {
  const sessions = require('../lib/state').list();
  if (!sessions.length) {
    console.log('no active ccshare sessions');
  } else {
    for (const s of sessions) {
      const dir = require('path').basename(s.cwd || '');
      const who = s.names && s.names.length ? ` (${s.names.join(', ')})` : '';
      console.log(`${s.code}  ${dir}  ${s.joiners || 0} connected${who}  port ${s.port}`);
      if (s.tunnel) console.log(`        anywhere: ccshare join ${s.code} --host ${s.tunnel}`);
    }
  }
} else if (cmd === 'update') {
  require('../lib/update').runUpdate();
} else if (cmd === 'menubar') {
  const ok = require('../lib/menubar').launch((m) => process.stderr.write(m), { persistent: true });
  console.log(ok ? 'ccshare: menu bar helper running' : 'ccshare: could not start the menu bar helper (needs macOS with the Xcode command line tools)');
} else {
  process.stderr.write(HELP);
  process.exit(cmd && cmd !== 'help' && cmd !== '--help' && cmd !== '-h' ? 1 : 0);
}
