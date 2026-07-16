'use strict';
const os = require('os');
const WebSocket = require('ws');
const { discover } = require('./discovery');
const { normalizeCode } = require('./codes');

const DEFAULT_PORT = 42518;

function die(msg) {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

async function join(codeArg, opts) {
  const code = normalizeCode(codeArg);
  if (!code) die('usage: manycode join <CODE>');
  require('./update').checkInBackground();
  if (require('./update').cachedBehind()) {
    process.stderr.write("manycode: a newer manycode is on github - run 'manycode update'\n");
  }

  let url = null;
  let via = null;
  if (opts.host) {
    let h = String(opts.host);
    if (/^https?:\/\//.test(h)) h = h.replace(/^http/, 'ws'); // tunnel URLs pasted as https work too
    if (/^wss?:\/\//.test(h)) {
      url = h;
      via = 'tunnel';
    } else {
      const [hh, p] = h.split(':');
      url = `ws://${hh}:${p || DEFAULT_PORT}`;
      via = 'direct';
    }
  } else {
    process.stderr.write('manycode: looking for the session on your network…\n');
    const found = await discover(code, 3500);
    if (found) {
      url = `ws://${found.host}:${found.port}`;
      via = 'lan';
    } else if (opts.relay) {
      url = opts.relay;
      via = 'relay';
    } else {
      die(
        'manycode: no session found on this network.\n' +
        '  remote session? add --relay wss://your-relay (or set MANYCODE_RELAY)\n' +
        '  known IP (e.g. tailscale)? add --host <ip>:<port>'
      );
    }
  }

  let wsOpts;
  if (via === 'tunnel') {
    // fresh trycloudflare hostnames can be NXDOMAIN-cached by the OS
    // resolver; fall back to asking 1.1.1.1 directly
    const dns = require('dns');
    const resolver = new dns.promises.Resolver();
    resolver.setServers(['1.1.1.1', '8.8.8.8']);
    wsOpts = {
      lookup: (hostname, o, cb) => {
        if (typeof o === 'function') { cb = o; o = {}; }
        dns.lookup(hostname, o, (e, addr, fam) => {
          if (!e) return cb(null, addr, fam);
          resolver.resolve4(hostname).then((addrs) => {
            if (o && o.all) cb(null, addrs.map((address) => ({ address, family: 4 })));
            else cb(null, addrs[0], 4);
          }).catch(() => cb(e));
        });
      },
    };
  }
  const ws = new WebSocket(url, wsOpts);
  let replayed = false;
  let attached = false;
  const pending = [];

  const cleanup = () => {
    if (process.stdin.isTTY) try { process.stdin.setRawMode(false); } catch {}
    process.stdout.write('\x1b[?25h'); // make sure the cursor comes back
  };

  // chat renders inline; the agent's next repaint cleans the frame up
  const chatLine = (m, mine) => {
    const who = mine ? 'you' : m.from + (m.host ? ' (host)' : '');
    process.stderr.write(`\r\n\x1b[38;2;134;196;142m✦ ${who}:\x1b[0m ${m.text}\r\n`);
  };

  let composing = false;
  let composeBuf = '';
  const attach = () => {
    if (attached) return;
    attached = true;
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (d) => {
      if (d.includes(0x1d)) { // Ctrl-]
        cleanup();
        process.stderr.write('\nmanycode: detached. the session is still running on the host.\n');
        process.exit(0);
      }
      // Ctrl-T opens a chat line that never touches the shared prompt
      if (!composing && d.length === 1 && d[0] === 0x14) {
        composing = true;
        composeBuf = '';
        process.stderr.write('\r\n\x1b[38;2;217;119;87mchat ›\x1b[0m ');
        return;
      }
      if (composing) {
        for (const ch of d.toString('utf8')) {
          if (ch === '\r' || ch === '\n') {
            composing = false;
            const text = composeBuf.trim();
            composeBuf = '';
            process.stderr.write('\r\x1b[2K');
            if (text && ws.readyState === 1) {
              ws.send(JSON.stringify({ t: 'chat', text }));
              chatLine({ text }, true);
            }
            break;
          } else if (ch === '\x03' || ch === '\x1b' || ch === '\x14') { // esc / ctrl-c / ctrl-t cancel
            composing = false;
            composeBuf = '';
            process.stderr.write(' \x1b[38;2;92;101;112m(cancelled)\x1b[0m\r\n');
            break;
          } else if (ch === '\x7f' || ch === '\b') {
            if (composeBuf) { composeBuf = composeBuf.slice(0, -1); process.stderr.write('\b \b'); }
          } else if (ch >= ' ') {
            composeBuf += ch;
            process.stderr.write(ch);
          }
        }
        return; // composing keys never reach the session
      }
      if (ws.readyState === 1) ws.send(d);
    });
    process.stdout.on('resize', () => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ t: 'resize', cols: process.stdout.columns, rows: process.stdout.rows }));
      }
    });
  };

  ws.on('open', () => {
    ws.send(JSON.stringify({
      t: 'join',
      code,
      name: opts.name || require('./config').load().name || os.userInfo().username,
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
    }));
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // hold live output until the replay lands so frames arrive in order
      if (!replayed) pending.push(data);
      else process.stdout.write(data);
      return;
    }
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!m) return;
    if (m.t === 'chat') {
      chatLine(m);
    } else if (m.t === 'chatlog') {
      for (const c of m.msgs || []) chatLine(c);
    } else if (m.t === 'hold') {
      process.stderr.write('manycode: the host is being asked to let you in…\n');
    } else if (m.t === 'ok') {
      process.stderr.write(
        `manycode: connected (${via})${m.readOnly ? ' - view only' : ''}. Ctrl-] leaves, Ctrl-T chats.\n`
      );
      attach();
    } else if (m.t === 'replay') {
      process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
      if (m.d) process.stdout.write(Buffer.from(m.d, 'base64'));
      for (const p of pending) process.stdout.write(p);
      pending.length = 0;
      replayed = true;
      if (m.readOnly) process.stderr.write('manycode: view only - your keys are ignored.\n');
    } else if (m.t === 'err') {
      cleanup();
      die('manycode: ' + (m.msg || 'rejected'));
    } else if (m.t === 'exit') {
      cleanup();
      process.stderr.write('\nmanycode: host ended the session.\n');
      process.exit(0);
    }
  });

  // relay path sends 'ok' from the server and 'replay' from the host - if the
  // host never replays (empty buffer edge case), don't hold frames forever
  setTimeout(() => {
    if (!replayed) {
      replayed = true;
      for (const p of pending) process.stdout.write(p);
      pending.length = 0;
    }
  }, 3000);

  ws.on('close', () => {
    cleanup();
    process.stderr.write('\nmanycode: disconnected.\n');
    process.exit(0);
  });
  ws.on('error', (e) => {
    cleanup();
    die('manycode: connection failed: ' + e.message);
  });
}

module.exports = { join };
