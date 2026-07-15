'use strict';
const os = require('os');
const http = require('http');
const WebSocket = require('ws');
const { WebSocketServer } = require('ws');
const { Session } = require('./session');
const { generateCode, normalizeCode } = require('./codes');
const { startResponder } = require('./discovery');
const state = require('./state');

const DEFAULT_PORT = 42518;

// A joiner that stops reading (slow network, backgrounded tab, dead tunnel)
// makes ws buffer our output in host memory with no bound. If a socket falls
// this far behind, drop it - terminate() frees the queued bytes immediately,
// and they can rejoin to get a fresh replay. We never silently skip bytes: a
// gap mid-escape-sequence would leave the screen corrupted with no recovery.
const MAX_BUFFERED = Number(process.env.CCSHARE_MAX_BUFFERED) || 8 * 1024 * 1024; // ~32x the replay buffer

function makeSender(ws, onDrop) {
  let dropped = false;
  return (b) => {
    if (ws.readyState !== 1) return;
    if (ws.bufferedAmount > MAX_BUFFERED) {
      if (!dropped) {
        dropped = true;
        try { ws.terminate(); } catch {}
        if (onDrop) onDrop();
      }
      return;
    }
    ws.send(b);
  };
}

function lanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return null;
}

// Plain GETs on the ws port serve a self-contained xterm.js join page, so the
// tunnel URL doubles as a no-install browser join link (https://…/#CODE).
function servePage(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let html;
  try { html = require('fs').readFileSync(require('path').join(__dirname, 'join.html')); } catch {
    res.writeHead(500); return res.end('ccshare: join page missing');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(servePage);
    const wss = new WebSocketServer({ server });
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE' && port !== 0) {
        listen(0).then(resolve, reject); // another host on this machine - take any port
      } else {
        reject(e);
      }
    });
    server.listen(port, () => resolve({ server, wss }));
  });
}

// The npm 'cloudflared' optional dep downloads the official binary at
// install time; fall back to a system install if that download failed.
function cloudflaredBin() {
  try {
    const { bin } = require('cloudflared');
    if (require('fs').existsSync(bin)) return bin;
  } catch {}
  const probe = require('child_process').spawnSync('cloudflared', ['--version'], { stdio: 'ignore' });
  if (!probe.error && probe.status === 0) return 'cloudflared';
  return null;
}

// DNS lookup that falls back to querying 1.1.1.1 directly - fresh
// trycloudflare hostnames often hit a cached NXDOMAIN in the OS resolver.
function tunnelLookup() {
  const dns = require('dns');
  const resolver = new dns.promises.Resolver();
  resolver.setServers(['1.1.1.1', '8.8.8.8']);
  return (hostname, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    dns.lookup(hostname, opts, (e, addr, fam) => {
      if (!e) return cb(null, addr, fam);
      resolver.resolve4(hostname).then((addrs) => {
        if (opts && opts.all) cb(null, addrs.map((address) => ({ address, family: 4 })));
        else cb(null, addrs[0], 4);
      }).catch(() => cb(e));
    });
  };
}

// Poll the tunnel URL until the Cloudflare edge actually routes to us (a 530
// means the connector isn't registered yet). Our server answers plain HTTP
// with the browser join page, which proves the path works end to end.
function waitTunnelReady(url, timeoutMs = 45000) {
  const https = require('https');
  const host = url.replace('wss://', '');
  const lookup = tunnelLookup();
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const req = https.get({ host, path: '/', lookup, timeout: 5000 }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve(true);
        retry();
      });
      req.on('timeout', () => req.destroy());
      req.on('error', retry);
    };
    const retry = () => {
      if (Date.now() > deadline) return resolve(false);
      setTimeout(attempt, 2000);
    };
    attempt();
  });
}

// Free public wss:// endpoint via a Cloudflare quick tunnel - no account,
// dies with the process. cloudflared prints the random URL on stderr.
function startTunnel(port, timeoutMs = 20000) {
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    const bin = cloudflaredBin();
    if (!bin) {
      return resolve({ err: 'cloudflared not found (npm i inside ccshare re-downloads it)' });
    }
    const cp = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let done = false;
    const to = setTimeout(() => {
      if (!done) { done = true; try { cp.kill(); } catch {} resolve({ err: 'tunnel timed out' }); }
    }, timeoutMs);
    const scan = async (d) => {
      if (done) return;
      const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (!m) return;
      done = true;
      clearTimeout(to);
      const url = m[0].replace('https://', 'wss://');
      const ready = await waitTunnelReady(url);
      if (!ready) process.stderr.write('ccshare: tunnel is up but the edge is slow; joins may need a retry\n');
      resolve({ url, kill: () => { try { cp.kill(); } catch {} } });
    };
    cp.stdout.on('data', scan);
    cp.stderr.on('data', scan);
    cp.on('exit', () => {
      if (!done) { done = true; clearTimeout(to); resolve({ err: 'cloudflared exited early' }); }
    });
  });
}

function connectRelay(url, wantCode) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const to = setTimeout(() => { ws.terminate(); reject(new Error('relay timeout')); }, 8000);
    ws.once('open', () => ws.send(JSON.stringify({ t: 'host', code: wantCode })));
    ws.once('message', (data) => {
      clearTimeout(to);
      let m;
      try { m = JSON.parse(data); } catch { m = null; }
      if (m && m.t === 'code') resolve({ ws, code: m.code });
      else reject(new Error('relay handshake failed'));
    });
    ws.once('error', (e) => { clearTimeout(to); reject(e); });
  });
}

async function host(opts) {
  // joiners normalize what they type, so the host must announce the same form
  let code = normalizeCode(opts.code) || generateCode();
  if (opts.code && (code.length < 4 || code.length > 12)) {
    throw new Error(`--code must be 4-12 letters/digits (got '${opts.code}')`);
  }

  // fail with a real message now, not a cryptic pty error after the banner
  const cmdBin = opts.cmd || 'claude';
  const cmdOk = cmdBin.includes('/')
    ? (() => { try { require('fs').accessSync(cmdBin, require('fs').constants.X_OK); return true; } catch { return false; } })()
    : require('child_process').spawnSync('which', [cmdBin], { stdio: 'ignore' }).status === 0;
  if (!cmdOk) {
    throw new Error(`'${cmdBin}' not found - is it installed? (ccshare setup picks your default agent)`);
  }

  // relay is optional - LAN/direct always works
  let relay = null;
  if (opts.relay) {
    try {
      relay = await connectRelay(opts.relay, code);
      code = relay.code; // relay may reassign on collision
    } catch (e) {
      process.stderr.write(`ccshare: relay unreachable (${e.message}) - continuing LAN-only\n`);
    }
  }

  const session = new Session({ cmd: opts.cmd, args: opts.claudeArgs, readOnly: opts.readOnly });
  const { server, wss } = await listen(opts.port != null ? opts.port : DEFAULT_PORT);
  const port = server.address().port;
  const stopDiscovery = startResponder(code, port);
  const maxJoiners = opts.max || 5;

  // --approve: each joiner waits on a macOS dialog before they're let in.
  // The dialog is osascript, so on other platforms we admit automatically
  // (with a warning) rather than pretend to a security property we can't keep.
  let approveJoins = !!opts.approve;
  if (approveJoins && process.platform !== 'darwin' && !process.env.CCSHARE_APPROVE_TEST) {
    process.stderr.write('ccshare: join approval needs macOS (osascript) - admitting joiners automatically\n');
    approveJoins = false;
  }
  const askApproval = (name) => {
    if (process.env.CCSHARE_APPROVE_TEST) return Promise.resolve(process.env.CCSHARE_APPROVE_TEST === 'allow');
    const who = String(name || 'someone').replace(/[^\w .@-]/g, '').slice(0, 40) || 'someone';
    return new Promise((resolve) => {
      const script = `display dialog "${who} wants to join your ccshare session ${code}" with title "ccshare" buttons {"Deny", "Allow"} default button "Allow" giving up after 60`;
      require('child_process').execFile('osascript', ['-e', script], { timeout: 65000 }, (e, out) => {
        resolve(!e && /button returned:Allow/.test(String(out)) && !/gave up:true/.test(String(out)));
      });
    });
  };

  // --record: asciinema v2 cast. Sync appends so a SIGTERM can't lose the
  // tail - output arrives at terminal speed, so the disk write is noise.
  let rec = null;
  if (opts.record) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    rec = { file: require('path').join(process.cwd(), `ccshare-${code}-${stamp}.cast`), t0: Date.now() };
  }

  const hasCloudflared = cloudflaredBin() !== null;

  // tunnelRef.current is filled either now (--tunnel waits so the banner can
  // show the link) or in the background a few seconds after claude starts
  const tunnelRef = { current: null };
  if (opts.tunnel) {
    process.stderr.write('ccshare: opening cloudflare tunnel…\n');
    const t = await startTunnel(port);
    if (t.err) process.stderr.write(`ccshare: tunnel failed (${t.err}) - continuing without it\n`);
    else tunnelRef.current = t;
  }
  const tunnel = tunnelRef.current;

  const joiners = new Map(); // id -> {sendData, sendJson}
  const broadcast = (buf) => { for (const j of joiners.values()) j.sendData(buf); };

  const ip = lanIp();
  const cmdName = require('path').basename(opts.cmd || 'claude');
  const browserFor = (tunnelUrl, ipNow) => tunnelUrl
    ? tunnelUrl.replace('wss://', 'https://') + '/#' + code
    : (ipNow ? `http://${ipNow}:${port}/#${code}` : null);
  const lines = [
    '',
    `  ─── ccshare ─── multiplayer ${cmdName === 'claude' ? 'claude code' : cmdName} ───`,
    '',
    `  code:  ${code.slice(0, 3)} ${code.slice(3)}`,
    '',
    `  same wifi:   ccshare join ${code}`,
    ip ? `  direct:      ccshare join ${code} --host ${ip}:${port}` : null,
    tunnel ? `  anywhere:    ccshare join ${code} --host ${tunnel.url}` : null,
    !tunnel && !opts.noTunnel && hasCloudflared
      ? `  anywhere:    tunnel opening… link lands in the menu bar and 'ccshare code'`
      : null,
    !tunnel && !opts.noTunnel && !hasCloudflared
      ? `  anywhere:    tunnels unavailable (cloudflared missing - npm i inside ccshare fixes it)`
      : null,
    relay ? `  anywhere:    ccshare join ${code} --relay ${opts.relay}` : null,
    browserFor(tunnel && tunnel.url, ip)
      ? `  browser:     ${browserFor(tunnel && tunnel.url, ip)}  (no install needed${tunnel ? '' : ', this network'})`
      : null,
    rec ? `  recording:   ${require('path').basename(rec.file)}` : null,
    require('./update').cachedBehind()
      ? `  update:      a newer ccshare is on github - run 'ccshare update'`
      : null,
    approveJoins ? `  joiners wait for your ok (a dialog pops on each join)` : null,
    opts.readOnly ? `  joiners are view-only` : `  joiners can type - only share the code with people you trust`,
    '',
  ].filter((l) => l !== null);
  process.stderr.write(lines.join('\n') + '\n');

  if (process.platform === 'darwin' && !opts.noMenubar) {
    try { require('./menubar').launch((m) => process.stderr.write(m)); } catch {}
  }
  require('./update').checkInBackground();

  const writeState = () => {
    const ipNow = lanIp() || undefined; // fresh each write in case the network changed
    const tUrl = tunnelRef.current ? tunnelRef.current.url : undefined;
    state.write({
      pid: process.pid,
      code,
      port,
      ip: ipNow,
      cwd: process.cwd(),
      joiners: session.dims.size,
      names: [...session.names.values()],
      tunnel: tUrl,
      browser: browserFor(tUrl, ipNow) || undefined,
      cmd: cmdName,
      readOnly: session.readOnly || undefined,
      recording: rec ? rec.file : undefined,
    });
  };
  writeState();

  // default: open the tunnel in the background so startup isn't delayed;
  // the link shows up in the menu bar and `ccshare code` when ready
  let tunnelOpening = false;
  const openTunnelLater = () => {
    if (tunnelRef.current || tunnelOpening) return;
    tunnelOpening = true;
    startTunnel(port).then((t) => {
      tunnelOpening = false;
      if (t && t.url && !session.exited) {
        tunnelRef.current = t;
        writeState();
      } else if (t && t.kill) {
        t.kill();
      }
    });
  };
  if (!tunnel && !opts.noTunnel && hasCloudflared) openTunnelLater();

  // `ccshare tunnel` drops a request file to open a tunnel on a session
  // that started lan-only - works even after --no-tunnel
  const reqPath = require('path').join(require('os').homedir(), '.ccshare', 'sessions', process.pid + '.tunnel-request');
  const reqTimer = setInterval(() => {
    try {
      if (require('fs').existsSync(reqPath)) {
        require('fs').unlinkSync(reqPath);
        if (hasCloudflared) openTunnelLater();
      }
    } catch {}
  }, 2000);
  reqTimer.unref();

  const clearState = () => state.remove(process.pid);
  process.on('exit', clearState);
  // `ccshare stop` (or a closed terminal) signals us here. Restore the host's
  // tty before exiting - we put stdin in raw mode and hid the cursor, so a bare
  // exit would leave this terminal broken.
  const shutdown = () => {
    try { session.stop(); } catch {}
    if (process.stdin.isTTY) { try { process.stdin.setRawMode(false); } catch {} }
    try { process.stdout.write('\x1b[?25h'); } catch {}
    if (rec) { try { process.stderr.write(`\nccshare: recording saved: ${rec.file}\n`); } catch {} }
    clearState();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);

  session.start();
  session.on('output', broadcast);

  if (rec) {
    const fs = require('fs');
    const line = (arr) => { try { fs.appendFileSync(rec.file, JSON.stringify(arr) + '\n'); } catch {} };
    try {
      fs.writeFileSync(rec.file, JSON.stringify({
        version: 2,
        width: session._lastCols || 80,
        height: session._lastRows || 24,
        timestamp: Math.floor(rec.t0 / 1000),
        title: `ccshare ${code} - ${cmdName}`,
        env: { TERM: 'xterm-256color', SHELL: process.env.SHELL || '' },
      }) + '\n');
    } catch (e) {
      process.stderr.write(`ccshare: can't write recording (${e.message}) - continuing without it\n`);
      rec = null;
    }
    if (rec) {
      session.on('output', (buf) => line([(Date.now() - rec.t0) / 1000, 'o', buf.toString('utf8')]));
      session.on('resize', (cols, rows) => line([(Date.now() - rec.t0) / 1000, 'r', `${cols}x${rows}`]));
    }
  }

  session.on('roster', (ev) => {
    const n = session.dims.size;
    const title = `\x1b]0;ccshare ${code} · ${n} connected\x07`;
    process.stdout.write(title + (ev.joined ? '\x07' : '')); // bell on join
    broadcast(Buffer.from(title));
    writeState();
  });

  const onJoin = (id, m, sendJson) => {
    sendJson({
      t: 'replay',
      d: session.replayData().toString('base64'),
      readOnly: session.readOnly,
    });
    session.addParticipant(id, m.name, m.cols, m.rows);
    session.repaint();
  };

  // direct joiners (LAN / tailscale / port-forward / tunnel / browser)
  let nextDirect = 1;
  wss.on('connection', (ws) => {
    let id = null;
    let held = false; // waiting on the approval dialog - drop anything they send
    const authTimer = setTimeout(() => { if (!id && !held) ws.terminate(); }, 10000);
    const sendJson = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
    const admit = (m) => {
      if (session.dims.size >= maxJoiners) {
        sendJson({ t: 'err', msg: 'session full' });
        return ws.close();
      }
      id = 'd' + nextDirect++;
      const who = m.name || id;
      joiners.set(id, {
        sendData: makeSender(ws, () => process.stderr.write(`\nccshare: dropped ${who} - connection too far behind (they can rejoin)\n`)),
        sendJson,
      });
      sendJson({ t: 'ok', readOnly: session.readOnly });
      onJoin(id, m, sendJson);
    };
    ws.on('message', (data, isBinary) => {
      if (!id) {
        if (held) return;
        if (isBinary) return ws.terminate();
        let m;
        try { m = JSON.parse(data); } catch { return ws.terminate(); }
        if (!m || m.t !== 'join' || String(m.code || '').toUpperCase() !== code) {
          try { ws.send(JSON.stringify({ t: 'err', msg: 'wrong code' })); } catch {}
          return ws.close();
        }
        clearTimeout(authTimer);
        if (!approveJoins) return admit(m);
        held = true;
        sendJson({ t: 'hold' });
        askApproval(m.name).then((yes) => {
          held = false;
          if (ws.readyState !== 1) return;
          if (!yes) {
            sendJson({ t: 'err', msg: 'the host declined' });
            return ws.close();
          }
          admit(m);
        });
        return;
      }
      if (isBinary) return session.input(data);
      let m;
      try { m = JSON.parse(data); } catch { return; }
      if (m && m.t === 'resize') session.setDims(id, m.cols, m.rows);
    });
    ws.on('close', () => {
      if (id) {
        joiners.delete(id);
        session.removeParticipant(id);
      }
    });
  });

  // relay joiners arrive multiplexed over the single relay socket
  if (relay) {
    const ws = relay.ws;
    const sendJson = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
    joiners.set('_relay', {
      sendData: makeSender(ws),
      sendJson,
    });
    // relay input frames are anonymous (all joiners share this socket), so
    // while an approval is pending we can't tell approved keys from the
    // held joiner's - block them all for those few seconds
    const pendingRelay = new Set();
    ws.on('message', (data, isBinary) => {
      if (isBinary) return pendingRelay.size ? undefined : session.input(data);
      let m;
      try { m = JSON.parse(data); } catch { return; }
      if (!m) return;
      if (m.t === 'joined') {
        const finish = () => {
          if (session.dims.size >= maxJoiners) return sendJson({ t: 'err', to: m.id, msg: 'session full' });
          onJoin(m.id, m, (o) => sendJson({ ...o, to: m.id }));
        };
        if (!approveJoins) return finish();
        pendingRelay.add(m.id);
        sendJson({ t: 'hold', to: m.id });
        askApproval(m.name).then((yes) => {
          pendingRelay.delete(m.id);
          if (!yes) return sendJson({ t: 'err', to: m.id, msg: 'the host declined' });
          finish();
        });
      } else if (m.t === 'resize') {
        session.setDims(m.id, m.cols, m.rows);
      } else if (m.t === 'left') {
        pendingRelay.delete(m.id);
        session.removeParticipant(m.id);
      }
    });
    ws.on('close', () => {
      joiners.delete('_relay');
      for (const pid of [...session.dims.keys()]) {
        if (String(pid).startsWith('r')) session.removeParticipant(pid);
      }
      if (!session.exited) process.stderr.write('\nccshare: lost relay connection - LAN joiners unaffected\n');
    });
    ws.on('error', () => {});
  }

  session.on('exit', (exitCode) => {
    clearState();
    for (const j of joiners.values()) j.sendJson({ t: 'exit' });
    setTimeout(() => {
      try { wss.close(); } catch {}
      try { server.close(); } catch {}
      if (relay) try { relay.ws.close(); } catch {}
      if (tunnelRef.current) tunnelRef.current.kill();
      stopDiscovery();
      if (process.stdin.isTTY) try { process.stdin.setRawMode(false); } catch {}
      process.stderr.write(`\nccshare: session ${code} ended.\n`);
      if (rec) process.stderr.write(`ccshare: recording saved: ${rec.file}\n`);
      process.exit(exitCode || 0);
    }, 150);
  });
}

module.exports = { host, DEFAULT_PORT };
