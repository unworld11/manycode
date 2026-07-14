'use strict';
const os = require('os');
const WebSocket = require('ws');
const { WebSocketServer } = require('ws');
const { Session } = require('./session');
const { generateCode } = require('./codes');
const { startResponder } = require('./discovery');
const state = require('./state');

const DEFAULT_PORT = 42518;

function lanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return null;
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port });
    wss.once('listening', () => resolve(wss));
    wss.once('error', (e) => {
      if (e.code === 'EADDRINUSE' && port !== 0) {
        listen(0).then(resolve, reject); // another host on this machine - take any port
      } else {
        reject(e);
      }
    });
  });
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
// means the connector isn't registered yet). Our ws server answers plain
// HTTP with 426, which proves the path works end to end.
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
  const { spawn, spawnSync } = require('child_process');
  return new Promise((resolve) => {
    const probe = spawnSync('cloudflared', ['--version'], { stdio: 'ignore' });
    if (probe.error || probe.status !== 0) {
      return resolve({ err: 'cloudflared not found (brew install cloudflared)' });
    }
    const cp = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], {
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
  let code = (opts.code || generateCode()).toUpperCase();

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
  const wss = await listen(opts.port != null ? opts.port : DEFAULT_PORT);
  const port = wss.address().port;
  const stopDiscovery = startResponder(code, port);
  const maxJoiners = opts.max || 5;

  let tunnel = null;
  if (opts.tunnel) {
    process.stderr.write('ccshare: opening cloudflare tunnel…\n');
    tunnel = await startTunnel(port);
    if (tunnel.err) {
      process.stderr.write(`ccshare: tunnel failed (${tunnel.err}) - continuing without it\n`);
      tunnel = null;
    }
  }

  const joiners = new Map(); // id -> {sendData, sendJson}
  const broadcast = (buf) => { for (const j of joiners.values()) j.sendData(buf); };

  const ip = lanIp();
  const lines = [
    '',
    `  ─── ccshare ─── multiplayer claude code ───`,
    '',
    `  code:  ${code.slice(0, 3)} ${code.slice(3)}`,
    '',
    `  same wifi:   ccshare join ${code}`,
    ip ? `  direct:      ccshare join ${code} --host ${ip}:${port}` : null,
    tunnel ? `  anywhere:    ccshare join ${code} --host ${tunnel.url}` : null,
    relay ? `  anywhere:    ccshare join ${code} --relay ${opts.relay}` : null,
    opts.readOnly ? `  joiners are view-only` : `  joiners can type - only share the code with people you trust`,
    '',
  ].filter((l) => l !== null);
  process.stderr.write(lines.join('\n') + '\n');

  if (process.platform === 'darwin' && !opts.noMenubar) {
    try { require('./menubar').launch((m) => process.stderr.write(m)); } catch {}
  }

  const writeState = () => state.write({
    pid: process.pid,
    code,
    port,
    ip: lanIp() || undefined, // fresh each write in case the network changed
    cwd: process.cwd(),
    joiners: session.dims.size,
    names: [...session.names.values()],
    tunnel: tunnel ? tunnel.url : undefined,
  });
  writeState();
  const clearState = () => state.remove(process.pid);
  process.on('exit', clearState);
  process.on('SIGTERM', () => { clearState(); process.exit(0); });
  process.on('SIGHUP', () => { clearState(); process.exit(0); });

  session.start();
  session.on('output', broadcast);

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

  // direct joiners (LAN / tailscale / port-forward)
  let nextDirect = 1;
  wss.on('connection', (ws) => {
    let id = null;
    const authTimer = setTimeout(() => { if (!id) ws.terminate(); }, 10000);
    ws.on('message', (data, isBinary) => {
      if (!id) {
        if (isBinary) return ws.terminate();
        let m;
        try { m = JSON.parse(data); } catch { return ws.terminate(); }
        if (!m || m.t !== 'join' || String(m.code || '').toUpperCase() !== code) {
          try { ws.send(JSON.stringify({ t: 'err', msg: 'wrong code' })); } catch {}
          return ws.close();
        }
        if (session.dims.size >= maxJoiners) {
          try { ws.send(JSON.stringify({ t: 'err', msg: 'session full' })); } catch {}
          return ws.close();
        }
        clearTimeout(authTimer);
        id = 'd' + nextDirect++;
        const sendJson = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
        joiners.set(id, {
          sendData: (b) => { if (ws.readyState === 1) ws.send(b); },
          sendJson,
        });
        sendJson({ t: 'ok', readOnly: session.readOnly });
        onJoin(id, m, sendJson);
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
      sendData: (b) => { if (ws.readyState === 1) ws.send(b); },
      sendJson,
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return session.input(data);
      let m;
      try { m = JSON.parse(data); } catch { return; }
      if (!m) return;
      if (m.t === 'joined') {
        if (session.dims.size >= maxJoiners) return sendJson({ t: 'err', to: m.id, msg: 'session full' });
        onJoin(m.id, m, (o) => sendJson({ ...o, to: m.id }));
      } else if (m.t === 'resize') {
        session.setDims(m.id, m.cols, m.rows);
      } else if (m.t === 'left') {
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
      if (relay) try { relay.ws.close(); } catch {}
      if (tunnel) tunnel.kill();
      stopDiscovery();
      if (process.stdin.isTTY) try { process.stdin.setRawMode(false); } catch {}
      process.stderr.write(`\nccshare: session ${code} ended.\n`);
      process.exit(exitCode || 0);
    }, 150);
  });
}

module.exports = { host, DEFAULT_PORT };
