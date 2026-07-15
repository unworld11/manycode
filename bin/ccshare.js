#!/usr/bin/env node
'use strict';

const HELP = `ccshare - multiplayer claude code

  ccshare host [options] [command [args...]]
      share a live terminal session with a join code. defaults to claude;
      name any agent to share it instead: codex, opencode, kimi, aider…
      --relay <url>    also accept joiners through a relay (or set CCSHARE_RELAY)
      --no-relay       ignore CCSHARE_RELAY for this session
      --port <n>       websocket port for direct joiners (default 42518)
      --code <code>    pick your own code instead of a random one
      --read-only      joiners can watch but not type
      --max <n>        max simultaneous joiners (default 5)
      --approve        each joiner waits until you allow them in a dialog
                       (macOS; ccshare setup can make it the default)
      --no-approve     let joiners straight in for this session
      --record         save the session as an asciinema .cast file
                       (play it back later with asciinema or asciinema.org)
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
      no terminal handy? the host's banner also shows a browser link -
      open it and you're in the session from any browser, no install.

  ccshare relay [--port <n>]
      run a relay server so friends outside your network can join.
      default port 8787, or the PORT env var.

  ccshare code
      print the codes of your active sessions (the banner scrolls away
      once claude starts drawing; this gets them back).

  ccshare tunnel [code]
      open the anywhere-tunnel on a session that's already running -
      for when you started lan-only and now want to invite someone
      remote. prints the join command when the tunnel is up.

  ccshare stop [code]
      end a running host session from another terminal (sends it a
      clean shutdown). with no code, stops the only session; if several
      are running, names them so you can pick one.

  ccshare menubar
      start the macOS menu bar helper by hand. it stays until you quit it
      from the menu. hosting starts it automatically.

  ccshare setup
      interactive onboarding: your name, default agent (claude, codex,
      opencode, kimi…), tunnel and menu bar preferences. runs by itself
      the first time you host; rerun it whenever you like.

  ccshare update
      pull the latest ccshare from github and reinstall deps. host and
      join tell you when you're behind.

  ccshare version
      print the installed version and commit.

examples
  you:            cd my-project && ccshare host
  friend (wifi):  ccshare join 7KQ2FM
  friend (remote): ccshare join 7KQ2FM --host wss://….trycloudflare.com
  other agents:   ccshare host codex        ccshare host opencode
  claude w/ args: ccshare host -- --resume
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
  // the first bare word starts the command to share (codex, opencode, …);
  // everything after it is that command's own argv
  const valueFlags = new Set(['--relay', '--port', '--code', '--max', '--cmd']);
  let cmdline = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') break;
    if (a.startsWith('--')) {
      if (valueFlags.has(a)) i++;
      continue;
    }
    cmdline = argv.splice(i);
    break;
  }
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
    '--approve': 'approve',
    '--no-approve': 'noApprove',
    '--record': 'record',
  });
  const relay = o.noRelay ? null : (o.relay || process.env.CCSHARE_RELAY || null);
  for (const [flag, key] of [['--port', 'port'], ['--max', 'max']]) {
    if (o[key] !== undefined && !/^\d+$/.test(String(o[key]))) die(`${flag} must be a number (got '${o[key]}')`);
  }
  (async () => {
    const config = require('../lib/config');
    // first ever run: onboard before hosting (Ctrl-C skips, saves defaults)
    if (!config.exists() && process.stdin.isTTY) {
      await require('../lib/setup').run({ keepStdin: true });
    }
    const cfg = config.load();
    return require('../lib/host').host({
      relay,
      port: o.port != null ? Number(o.port) : null,
      code: o.code,
      readOnly: !!o.readOnly,
      max: o.max ? Number(o.max) : undefined,
      cmd: o.cmd || (cmdline && cmdline[0]) || cfg.agent || 'claude',
      tunnel: !!o.tunnel,
      noTunnel: !!o.noTunnel || cfg.tunnel === false,
      noMenubar: !!o.noMenubar || cfg.menubar === false,
      approve: o.noApprove ? false : (!!o.approve || cfg.approve === true),
      record: !!o.record,
      claudeArgs: cmdline ? cmdline.slice(1).concat(o.rest || []) : (o.rest || []),
    });
  })().catch((e) => die('ccshare: ' + e.message));
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
      if (s.browser) console.log(`        browser:  ${s.browser}`);
    }
  }
} else if (cmd === 'tunnel') {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { normalizeCode } = require('../lib/codes');
  const sessions = require('../lib/state').list();
  const wanted = normalizeCode(argv[0]);
  const matches = wanted ? sessions.filter((s) => s.code === wanted) : sessions;
  if (!matches.length) die(wanted ? `ccshare: no active session with code ${wanted}` : 'ccshare: no active sessions');
  if (matches.length > 1) die('ccshare: several sessions running - pick one: ccshare tunnel <code>\n' + matches.map((s) => `  ${s.code}  ${path.basename(s.cwd || '')}`).join('\n'));
  const s = matches[0];
  if (s.tunnel) {
    console.log(`already open: ccshare join ${s.code} --host ${s.tunnel}`);
    process.exit(0);
  }
  fs.writeFileSync(path.join(os.homedir(), '.ccshare', 'sessions', s.pid + '.tunnel-request'), '');
  process.stderr.write('ccshare: asking the session to open a tunnel…\n');
  const t0 = Date.now();
  const poll = setInterval(() => {
    const cur = require('../lib/state').list().find((x) => x.pid === s.pid);
    if (cur && cur.tunnel) {
      clearInterval(poll);
      console.log(`anywhere: ccshare join ${cur.code} --host ${cur.tunnel}`);
      process.exit(0);
    }
    if (!cur) { clearInterval(poll); die('ccshare: that session ended'); }
    if (Date.now() - t0 > 90000) { clearInterval(poll); die('ccshare: tunnel did not come up in 90s - check the host terminal'); }
  }, 1500);
} else if (cmd === 'stop') {
  const path = require('path');
  const { normalizeCode } = require('../lib/codes');
  const sessions = require('../lib/state').list();
  const wanted = normalizeCode(argv[0]);
  const matches = wanted ? sessions.filter((s) => s.code === wanted) : sessions;
  if (!matches.length) die(wanted ? `ccshare: no active session with code ${wanted}` : 'ccshare: no active sessions');
  if (matches.length > 1) die('ccshare: several sessions running - pick one: ccshare stop <code>\n' + matches.map((s) => `  ${s.code}  ${path.basename(s.cwd || '')}`).join('\n'));
  const s = matches[0];
  // A dead host that was SIGKILLed leaves its state file behind; if the OS has
  // since recycled its pid, that pid now owns an unrelated process. state.list()
  // only proves the pid is alive, so confirm it's actually ccshare before we
  // signal it - otherwise `stop` could kill a stranger.
  const ps = require('child_process').spawnSync('ps', ['-p', String(s.pid), '-o', 'command='], { encoding: 'utf8' });
  if (ps.status === 0 && ps.stdout && !/ccshare/.test(ps.stdout)) {
    die(`ccshare: pid ${s.pid} for ${s.code} isn't a ccshare process anymore - clearing that stale entry`);
  }
  try { process.kill(s.pid, 'SIGTERM'); } catch (e) { die(`ccshare: could not stop ${s.code} (${e.message})`); }
  console.log(`ccshare: stopped ${s.code}`);
} else if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
  const pkg = require('../package.json');
  let commit = '';
  try {
    commit = ' (' + require('child_process')
      .execFileSync('git', ['-C', require('path').join(__dirname, '..'), 'rev-parse', '--short', 'HEAD'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() + ')';
  } catch {}
  console.log(`ccshare ${pkg.version}${commit}`);
} else if (cmd === 'setup') {
  require('../lib/setup').run().then(() => process.exit(0)).catch(() => process.exit(1));
} else if (cmd === 'update') {
  require('../lib/update').runUpdate();
} else if (cmd === 'menubar') {
  const ok = require('../lib/menubar').launch((m) => process.stderr.write(m), { persistent: true });
  console.log(ok ? 'ccshare: menu bar helper running' : 'ccshare: could not start the menu bar helper (needs macOS with the Xcode command line tools)');
} else {
  process.stderr.write(HELP);
  process.exit(cmd && cmd !== 'help' && cmd !== '--help' && cmd !== '-h' ? 1 : 0);
}
