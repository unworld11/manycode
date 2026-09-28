'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const { randomBytes, randomUUID } = require('crypto');
const { CodexRPC } = require('./codex-rpc');

function transcript(thread) {
  return {
    id: thread.id, title: thread.name || 'Shared Codex conversation',
    turns: (thread.turns || []).map(turn => ({
      id: turn.id, status: turn.status,
      items: (turn.items || []).flatMap(item => {
        if (item.type === 'userMessage') return [{ id: item.id, role: 'user', text: (item.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n') }];
        if (item.type === 'agentMessage') return [{ id: item.id, role: 'assistant', text: item.text }];
        if (item.type === 'commandExecution') return [{ id: item.id, role: 'tool', text: `Command: ${item.command}\nStatus: ${item.status}` }];
        if (item.type === 'fileChange') return [{ id: item.id, role: 'tool', text: `File changes: ${(item.changes || []).map(c => c.path).join(', ')}\nStatus: ${item.status}` }];
        return [];
      }),
    })),
  };
}
function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 20000) throw new Error('Prompt is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
async function startShare({ rpc, threadId, port = 0, guestName = 'Teammate' }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 -]{0,39}$/.test(guestName)) throw new Error('Use a guest name of 1–40 letters, numbers, spaces or hyphens');
  const initial = await rpc.request('thread/read', { threadId, includeTurns: true });
  if (initial.thread.id !== threadId) throw new Error('Unexpected thread returned by Codex');
  // Probe support without adding input or loading/taking ownership of the thread.
  await rpc.request('thread/queue/list', { threadId, limit: 1 });
  const contributor = randomBytes(32).toString('base64url');
  const viewer = randomBytes(32).toString('base64url');
  const access = new Map([[contributor, { role: 'contributor', name: guestName }], [viewer, { role: 'viewer', name: 'Viewer' }]]);
  const submissions = new Map();
  let outstanding = 0;
  let refresh;
  let snapshot = transcript(initial.thread);
  let refreshedAt = Date.now();
  let stopped = false;
  let pollTimer;
  let polling = false;
  let unavailable = false;
  const listeners = new Set();
  function closeSocket(ws, code = 1000, reason = '') {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.close(code, reason);
    const deadline = setTimeout(() => ws.terminate(), 1000);
    deadline.unref();
    ws.once('close', () => clearTimeout(deadline));
  }
  function removeListener(listener, code = 1000, reason = '') {
    listeners.delete(listener);
    closeSocket(listener.ws, code, reason);
    if (!listeners.size) { clearTimeout(pollTimer); pollTimer = undefined; }
  }
  function sendEvent(listener, event, data) {
    if (!access.has(listener.token)) return removeListener(listener, 4401, 'Invite is missing or revoked');
    if (listener.ws.readyState !== WebSocket.OPEN) return removeListener(listener);
    // Bound queued data for clients that cannot keep up; reconnect gets a snapshot.
    if (listener.ws.bufferedAmount > 1024 * 1024) { listener.ws.terminate(); return removeListener(listener); }
    listener.ws.send(JSON.stringify({ event, data: { ...data, role: listener.role, guestName: listener.name } }), error => {
      if (error) { listener.ws.terminate(); removeListener(listener); }
    });
  }
  function publish(next) {
    const previous = new Map(snapshot.turns.map(turn => [turn.id, turn]));
    const nextIds = new Set(next.turns.map(turn => turn.id));
    const removedTurnIds = snapshot.turns.filter(turn => !nextIds.has(turn.id)).map(turn => turn.id);
    const turns = next.turns.filter(turn => JSON.stringify(previous.get(turn.id)) !== JSON.stringify(turn));
    const expectedOrder = [...snapshot.turns.filter(turn => nextIds.has(turn.id)), ...next.turns.filter(turn => !previous.has(turn.id))].map(turn => turn.id);
    const reordered = expectedOrder.some((id, index) => id !== next.turns[index]?.id);
    const changed = turns.length || removedTurnIds.length || snapshot.title !== next.title || reordered;
    snapshot = next;
    if (changed) for (const listener of listeners) sendEvent(listener, reordered ? 'snapshot' : 'update', reordered ? snapshot : { id: snapshot.id, title: snapshot.title, turns, removedTurnIds });
  }
  function refreshSnapshot() {
    if (!refresh) refresh = rpc.request('thread/read', { threadId, includeTurns: true }).then(result => {
      if (result.thread.id !== threadId) throw new Error('Unexpected thread returned by Codex');
      if (!stopped) publish(transcript(result.thread));
      refreshedAt = Date.now();
      if (unavailable && !stopped) {
        unavailable = false;
        for (const listener of listeners) sendEvent(listener, 'available', {});
      }
    }).finally(() => { refresh = undefined; });
    return refresh;
  }
  function schedulePoll() {
    if (stopped || !listeners.size || pollTimer || polling) return;
    pollTimer = setTimeout(async () => {
      pollTimer = undefined; polling = true;
      try { await refreshSnapshot(); }
      catch {
        if (!unavailable) for (const listener of listeners) sendEvent(listener, 'unavailable', { error: 'Waiting for the host connection' });
        unavailable = true;
      }
      finally { polling = false; schedulePoll(); }
    }, unavailable ? 1000 : 250);
  }
  const heartbeat = setInterval(() => {
    for (const listener of listeners) {
      if (!listener.alive) { listener.ws.terminate(); removeListener(listener); continue; }
      listener.alive = false; listener.ws.ping();
    }
  }, 15000);
  heartbeat.unref();
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'", 'referrer-policy': 'no-referrer' });
        return res.end(fs.readFileSync(path.join(__dirname, 'share-thread.html')));
      }
      if (req.url === '/client.js' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
        return res.end(fs.readFileSync(path.join(__dirname, 'share-thread-client.js')));
      }
      const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
      const actor = access.get(token);
      if (!actor) return json(res, 401, { error: 'Invite is missing or revoked' });
      if (req.url === '/conversation' && req.method === 'GET') {
        if (Date.now() - refreshedAt > 1000) await refreshSnapshot();
        if (!access.has(token)) return json(res, 401, { error: 'Invite is missing or revoked' });
        return json(res, 200, { ...snapshot, role: actor.role, guestName: actor.name });
      }
      if (req.url !== '/prompt' || req.method !== 'POST') return json(res, 404, { error: 'Not found' });
      if (actor.role !== 'contributor') return json(res, 403, { error: 'This invite is view-only' });
      const input = await body(req);
      if (!access.has(token)) return json(res, 401, { error: 'Invite is missing or revoked' });
      if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 16000 || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.requestId)) {
        return json(res, 400, { error: 'A prompt and unique requestId are required' });
      }
      const key = `${token}:${input.requestId}`;
      const previous = submissions.get(key);
      if (previous) {
        if (previous.text !== input.text) return json(res, 409, { error: 'requestId was already used for a different prompt' });
        const result = await previous.result;
        return json(res, result.status, result.value);
      }
      if (outstanding >= 8 || submissions.size >= 200) return json(res, 429, { error: 'Session prompt limit reached; ask the host to restart sharing' });
      outstanding++;
      const clientUserMessageId = randomUUID();
      const result = rpc.request('thread/queue/add', { threadId,
        clientUserMessageId, input: [{ type: 'text', text: `[Manycode participant: ${actor.name}]\n${input.text.trim()}` }],
      }).then(value => ({ status: 202, value: { status: 'queued', id: value.queuedSubmission.id, clientUserMessageId } }))
        .catch(() => ({ status: 503, value: { error: 'Codex did not confirm delivery. Check the host chat before retrying.', status: 'unknown' } }))
        .finally(() => { outstanding--; });
      submissions.set(key, { text: input.text, result });
      const response = await result;
      return json(res, response.status, response.value);
    } catch {
      if (!res.headersSent) json(res, 400, { error: 'Unable to process this request; check the host connection' });
      else res.end();
    }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (stopped || req.url !== '/events' || sockets.clients.size >= 32) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(req, socket, head, ws => {
      let listener;
      const authTimer = setTimeout(() => closeSocket(ws, 4401, 'Invite is missing or revoked'), 5000);
      authTimer.unref();
      ws.on('error', () => ws.terminate());
      ws.on('close', () => { clearTimeout(authTimer); if (listener) removeListener(listener); });
      ws.on('pong', () => { if (listener) listener.alive = true; });
      ws.on('message', (bytes, binary) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (listener) { removeListener(listener, 1008, 'Unexpected message'); return; }
        clearTimeout(authTimer);
        let token;
        try { if (!binary) token = JSON.parse(bytes.toString()).token; } catch {}
        const actor = typeof token === 'string' && access.get(token);
        if (!actor) { closeSocket(ws, 4401, 'Invite is missing or revoked'); return; }
        listener = { ws, token, role: actor.role, name: actor.name, alive: true };
        listeners.add(listener);
        sendEvent(listener, 'snapshot', snapshot);
        if (unavailable) sendEvent(listener, 'unavailable', { error: 'Waiting for the host connection' });
        schedulePoll();
      });
    });
  });
  server.requestTimeout = 25000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = `http://127.0.0.1:${server.address().port}`;
  return { server, contributor, viewer, address, threadId,
    revoke: token => {
      const deleted = access.delete(token);
      for (const listener of listeners) if (listener.token === token) removeListener(listener, 4401, 'Invite is missing or revoked');
      return deleted;
    },
    close: () => new Promise(resolve => {
      stopped = true; clearTimeout(pollTimer); clearInterval(heartbeat); access.clear();
      for (const listener of listeners) removeListener(listener);
      for (const ws of sockets.clients) ws.terminate();
      sockets.close(); server.close(resolve); server.closeAllConnections();
    }),
  };
}
async function run(opts) {
  if (!opts.thread && !opts.name) throw new Error('Choose exactly one chat with --thread ID or --name EXACT_TITLE');
  if (opts.thread && opts.name) throw new Error('Use either --thread or --name');
  const port = opts.port === undefined ? 0 : Number(opts.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  const rpc = new CodexRPC({ socket: opts.socket });
  let share, tunnel;
  try {
    await rpc.initialize();
    let threadId = opts.thread;
    if (!threadId) {
      const list = await rpc.request('thread/list', { searchTerm: opts.name, limit: 100, sourceKinds: [], useStateDbOnly: true });
      const matches = list.data.filter(t => t.name === opts.name);
      if (matches.length !== 1) throw new Error('Expected one exact title match. Use --thread with the chosen chat ID.');
      threadId = matches[0].id;
    }
    share = await startShare({ rpc, threadId, port, guestName: opts.guestName });
    let address = share.address;
    if (opts.tunnel) {
      tunnel = await require('./host').startTunnel(share.server.address().port);
      if (!tunnel.url) throw new Error(tunnel.err || 'Tunnel did not start');
      address = tunnel.url.replace(/^wss:/, 'https:');
    }
    console.log(`Sharing only thread ${threadId}. Keep that chat open in ChatGPT/Codex so it can process queued messages.`);
    console.log(`Contributor invite: ${address}/#${share.contributor}`);
    console.log(`View-only invite: ${address}/#${share.viewer}`);
    console.log('Invites grant access to this conversation. Names label invites; they are not verified accounts. Ctrl-C revokes both invites.');
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; tunnel?.kill?.(); await share.close(); rpc.close(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return share;
  } catch (error) { tunnel?.kill?.(); if (share) await share.close(); rpc.close(); throw error; }
}
module.exports = { startShare, run, transcript };
