'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
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
  let refreshedAt = 0;
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
        if (Date.now() - refreshedAt > 1000) {
          if (!refresh) refresh = rpc.request('thread/read', { threadId, includeTurns: true }).then(result => {
            snapshot = transcript(result.thread); refreshedAt = Date.now();
          }).finally(() => { refresh = undefined; });
          await refresh;
        }
        return json(res, 200, { ...snapshot, role: actor.role });
      }
      if (req.url !== '/prompt' || req.method !== 'POST') return json(res, 404, { error: 'Not found' });
      if (actor.role !== 'contributor') return json(res, 403, { error: 'This invite is view-only' });
      const input = await body(req);
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
      const result = rpc.request('thread/queue/add', { threadId,
        clientUserMessageId: randomUUID(), input: [{ type: 'text', text: `[Manycode participant: ${actor.name}]\n${input.text.trim()}` }],
      }).then(value => ({ status: 202, value: { status: 'queued', id: value.queuedSubmission.id } }))
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
  server.requestTimeout = 25000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = `http://127.0.0.1:${server.address().port}`;
  return { server, contributor, viewer, address, threadId,
    revoke: token => access.delete(token),
    close: () => new Promise(resolve => { access.clear(); server.close(resolve); server.closeAllConnections(); }),
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
