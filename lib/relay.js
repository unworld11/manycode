'use strict';
const http = require('http');
const { WebSocketServer } = require('ws');
const { generateCode, normalizeCode } = require('./codes');

// A joiner that stops reading would make us buffer the host's output without
// bound - drop it instead; the host gets a 'left' from the close handler and
// the joiner can reconnect for a fresh replay.
const MAX_BUFFERED = Number(process.env.CCSHARE_MAX_BUFFERED) || 8 * 1024 * 1024;

// Dumb pipe: pairs a host socket with joiner sockets by code and forwards
// frames. Binary host->joiners is broadcast, binary joiner->host is input,
// JSON control frames get routed/stamped with the joiner id.
function startRelay(port) {
  const rooms = new Map(); // code -> {code, host, joiners: Map<id, ws>, nextId}

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`ccshare relay - ${rooms.size} active session(s)\n`);
  });
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    let role = null;
    let room = null;
    let id = null;

    ws.on('message', (data, isBinary) => {
      if (!role) {
        if (isBinary) return ws.terminate();
        let m;
        try { m = JSON.parse(data); } catch { return ws.terminate(); }
        if (m && m.t === 'host') {
          let code = normalizeCode(m.code);
          if (!/^[A-Z0-9]{4,12}$/.test(code) || rooms.has(code)) {
            do { code = generateCode(); } while (rooms.has(code));
          }
          room = { code, host: ws, joiners: new Map(), nextId: 1 };
          rooms.set(code, room);
          role = 'host';
          ws.send(JSON.stringify({ t: 'code', code }));
        } else if (m && m.t === 'join') {
          const r = rooms.get(normalizeCode(m.code));
          if (!r || r.host.readyState !== 1) {
            try { ws.send(JSON.stringify({ t: 'err', msg: 'no such session' })); } catch {}
            return ws.close();
          }
          room = r;
          role = 'joiner';
          id = 'r' + room.nextId++;
          room.joiners.set(id, ws);
          ws.send(JSON.stringify({ t: 'ok' }));
          room.host.send(JSON.stringify({ t: 'joined', id, name: m.name, cols: m.cols, rows: m.rows }));
        } else {
          ws.terminate();
        }
        return;
      }

      if (role === 'host') {
        if (isBinary) {
          for (const j of room.joiners.values()) {
            if (j.readyState !== 1) continue;
            if (j.bufferedAmount > MAX_BUFFERED) { try { j.terminate(); } catch {} continue; }
            j.send(data);
          }
          return;
        }
        let m;
        try { m = JSON.parse(data); } catch { return; }
        if (!m) return;
        if (m.to) {
          const j = room.joiners.get(m.to);
          delete m.to;
          if (j && j.readyState === 1) j.send(JSON.stringify(m));
        } else {
          const s = JSON.stringify(m);
          for (const j of room.joiners.values()) { if (j.readyState === 1) j.send(s); }
        }
      } else {
        if (room.host.readyState !== 1) return;
        if (isBinary) return room.host.send(data);
        let m;
        try { m = JSON.parse(data); } catch { return; }
        if (!m) return;
        m.id = id;
        room.host.send(JSON.stringify(m));
      }
    });

    ws.on('close', () => {
      if (role === 'host' && room) {
        for (const j of room.joiners.values()) {
          try { j.send(JSON.stringify({ t: 'exit' })); } catch {}
          try { j.close(); } catch {}
        }
        rooms.delete(room.code);
      } else if (role === 'joiner' && room) {
        room.joiners.delete(id);
        if (room.host.readyState === 1) {
          room.host.send(JSON.stringify({ t: 'left', id }));
        }
      }
    });
    ws.on('error', () => {});
  });

  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, 30000);
  wss.on('close', () => clearInterval(hb));

  server.listen(port, () => {
    process.stderr.write(`ccshare relay listening on :${port}\n`);
  });
  return server;
}

module.exports = { startRelay };
