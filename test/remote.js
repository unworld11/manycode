'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { once } = require('events');
const { randomBytes } = require('crypto');
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'manycode-remote-'));
process.env.MANYCODE_STATE_DIR = state;
const { run, parseInvite } = require('../lib/remote');
const token = randomBytes(32).toString('hex');
const output = [];
const out = text => output.push(text);
let role = 'contributor';
let redirect = false;
let redirected = 0;
let deliveryUnknown = false;
const requests = [];
const server = http.createServer(async (req, res) => {
  requests.push({ url: req.url, auth: req.headers.authorization });
  if (req.url === '/redirected') { redirected++; res.end('{}'); return; }
  if (redirect) { res.writeHead(302, { location: '/redirected' }); res.end(); return; }
  res.setHeader('content-type', 'application/json');
  if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); res.end('{}'); return; }
  if (req.url === '/conversation') res.end(JSON.stringify({ id: 'selected', title: 'Only selected chat', role, turns: [{ items: [{ role: 'assistant', text: 'Mango' }] }] }));
  else if (req.url === '/prompt') {
    let body = ''; for await (const chunk of req) body += chunk;
    const value = JSON.parse(body);
    assert.deepEqual(Object.keys(value).sort(), ['requestId', 'text']);
    assert.match(value.requestId, /^[0-9a-f-]{36}$/);
    assert.equal(value.text, 'Hello host');
    res.writeHead(role === 'viewer' ? 403 : deliveryUnknown ? 503 : 202);
    res.end(JSON.stringify({ status: 'queued' }));
  } else { res.writeHead(404); res.end('{}'); }
});
(async () => {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const invite = `${origin}/#${token}`;
  try {
    assert.throws(() => parseInvite(`http://example.com/#${token}`), /HTTPS/);
    assert.throws(() => parseInvite(`https://name:password@example.com/#${token}`), /original/);
    await run(['connect', invite], out);
    assert.equal(fs.statSync(state).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(state, 'remote.json')).mode & 0o777, 0o600);
    await run(['read'], out);
    assert.ok(output.some(text => text.includes('assistant: Mango')));
    await run(['read', '--json'], out);
    assert.equal(JSON.parse(output.at(-1)).id, 'selected');
    await run(['prompt', 'Hello host'], out);
    assert.match(output.at(-1), /does not mean completed/);
    deliveryUnknown = true;
    const promptCount = requests.filter(request => request.url === '/prompt').length;
    await assert.rejects(run(['prompt', 'Hello host'], out), /delivery is unknown.*Read the conversation before retrying/);
    assert.equal(requests.filter(request => request.url === '/prompt').length, promptCount + 1, 'unknown delivery must not automatically retry');
    deliveryUnknown = false;
    role = 'viewer';
    await assert.rejects(run(['prompt', 'Hello host'], out), /cannot send/);
    redirect = true;
    await assert.rejects(run(['read'], out), /Could not reach/);
    assert.equal(redirected, 0, 'redirects must never receive the access token');
    assert.ok(requests.every(request => request.url === '/conversation' || request.url === '/prompt'));
    assert.ok(requests.every(request => request.auth === `Bearer ${token}`));
    assert.ok(!output.join('\n').includes(token));
    await run(['disconnect'], out);
    assert.ok(!fs.existsSync(path.join(state, 'remote.json')));
    assert.match(output.at(-1), /remains valid/);
    fs.symlinkSync(path.join(state, 'other'), path.join(state, 'remote.json'));
    await assert.rejects(run(['disconnect'], out), /Unsafe/);
    console.log('remote guest CLI: auth, scope, roles, storage, redirects and disconnect passed');
  } finally { server.closeAllConnections(); server.close(); fs.rmSync(state, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
