'use strict';
const assert = require('assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { WebSocketServer } = require('ws');
(async () => {
  const streams = new Set();
  const history = Array.from({ length: 25 }, (_, n) => ({ id: `t${n}`, status: 'completed', items: [{ id: `i${n}`, role: 'assistant', text: `Earlier answer ${n}\n${'History. '.repeat(25)}` }] }));
  let state = { id: 'chat', title: 'Streaming test', turns: history, role: 'contributor', guestName: 'Bob' };
  let posted;
  let connections = 0;
  let reject = false;
  let failPrompt = false;
  const event = (socket, type, value) => socket.send(JSON.stringify({ event: type, data: value }));
  const server = http.createServer(async (req, res) => {
    if (['/', '/client.js', '/markdown.js'].includes(req.url)) {
      res.setHeader('content-type', req.url === '/' ? 'text/html' : 'text/javascript');
      return res.end(fs.readFileSync(path.join(__dirname, '..', 'lib', req.url === '/' ? 'share-thread.html' : req.url === '/markdown.js' ? 'markdown-renderer.js' : 'share-thread-client.js')));
    }
    assert.equal(req.headers.authorization, 'Bearer test-secret');
    if (reject) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'Invite is revoked' })); }
    if (req.url === '/prompt') {
      let input = ''; for await (const chunk of req) input += chunk;
      posted = JSON.parse(input);
      await new Promise(resolve => setTimeout(resolve, 200));
      if (failPrompt) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'Delivery not confirmed' })); }
      res.writeHead(202, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ status: 'queued', id: 'q1' }));
    }
    res.writeHead(404); res.end();
  });
  const wss = new WebSocketServer({ server, path: '/events' });
  wss.on('connection', (socket, req) => {
    assert.equal(req.url, '/events', 'Invite secret is absent from WebSocket URL');
    socket.once('message', raw => {
      assert.equal(JSON.parse(raw).token, 'test-secret');
      if (reject) return socket.close(4401, 'Invite is missing or revoked');
      connections++;
      streams.add(socket); socket.on('close', () => streams.delete(socket));
      event(socket, 'snapshot', state);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 750 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/#test-secret`);
    await page.waitForFunction(() => document.querySelectorAll('article').length === 25);
    assert(!page.url().includes('test-secret'));
    await page.evaluate(() => { window.firstArticle = document.querySelector('article'); document.querySelector('#messages').scrollTop = 0; });
    const changed = { ...history[24], items: [{ ...history[24].items[0], text: 'Updated answer 🥭' }] };
    const bytes = Buffer.from(JSON.stringify({ event: 'update', data: { ...state, turns: [changed], removedTurnIds: [] } }));
    const split = bytes.indexOf(Buffer.from('🥭')) + 2;
    for (const socket of streams) { socket.send(bytes.subarray(0, split), { binary: false, fin: false }); setTimeout(() => socket.send(bytes.subarray(split), { binary: false, fin: true }), 25); }
    await page.waitForFunction(() => document.body.textContent.includes('Updated answer 🥭'));
    assert(await page.evaluate(() => window.firstArticle === document.querySelector('article')));
    assert.equal(await page.locator('#messages').evaluate(el => el.scrollTop), 0);
    await page.locator('#prompt').fill('Remember mango');
    await page.locator('#send').click();
    await page.waitForFunction(() => document.querySelector('#pending article')?.textContent.includes('Remember mango'));
    await page.waitForFunction(() => document.querySelector('#delivery').textContent.startsWith('Queued'));
    assert.equal(posted.text, 'Remember mango');
    const guest = { id: 'guest', status: 'inProgress', items: [{ id: 'g1', role: 'user', text: '[Manycode participant: Bob]\nRemember mango' }] };
    for (const res of streams) event(res, 'update', { ...state, turns: [guest], removedTurnIds: [] });
    await page.waitForFunction(() => document.querySelector('#delivery').textContent === 'Running');
    assert.equal(await page.locator('#pending article').count(), 0);
    assert.equal(await page.locator('[data-turn-id=guest] b').textContent(), 'Bob');
    assert(!(await page.locator('[data-turn-id=guest]').textContent()).includes('[Manycode participant:'));
    guest.status = 'completed'; guest.items.push({ id: 'a1', role: 'assistant', text: 'Mango received 🥭' });
    state = { ...state, turns: [...history.slice(0, 24), changed, guest] };
    for (const res of streams) event(res, 'update', { ...state, turns: [guest], removedTurnIds: [] });
    await page.waitForFunction(() => document.querySelector('#delivery').textContent === 'Finished');
    const reply = await page.locator('article').last().boundingBox();
    const composer = await page.locator('#composer').boundingBox();
    assert(reply.y >= 0 && reply.y + reply.height <= composer.y, 'Reply remains visible above composer');
    for (const socket of streams) socket.close();
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'Live');
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert(connections >= 2, 'Stream reconnects');
    assert.equal(await page.locator('article').count(), 27);
    await page.locator('#prompt').fill('Remember mango');
    await page.locator('#send').click();
    await page.waitForFunction(() => document.querySelector('#delivery').textContent.startsWith('Queued'));
    const other = { id: 'other', status: 'completed', items: [{ id: 'o1', role: 'user', text: '[Manycode participant: Alice]\nRemember mango' }, { id: 'o2', role: 'assistant', text: 'Unrelated answer' }] };
    for (const res of streams) event(res, 'update', { ...state, turns: [other], removedTurnIds: [] });
    await page.waitForFunction(() => document.body.textContent.includes('Unrelated answer'));
    assert((await page.locator('#delivery').textContent()).startsWith('Queued'), 'Other participant and historical identical prompt do not finish this prompt');
    assert.equal(await page.locator('#pending article').count(), 1);
    const repeated = { id: 'repeat', status: 'completed', items: [{ id: 'r1', role: 'user', text: '[Manycode participant: Bob]\nRemember mango' }, { id: 'r2', role: 'assistant', text: 'Repeated answer' }] };
    for (const res of streams) event(res, 'update', { ...state, turns: [repeated], removedTurnIds: [] });
    await page.waitForFunction(() => document.querySelector('#delivery').textContent === 'Finished');
    assert.equal(await page.locator('#pending article').count(), 0);
    for (const res of streams) event(res, 'unavailable', { error: 'Waiting for host' });
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'Waiting for host');
    for (const res of streams) event(res, 'available', {});
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'Live');
    failPrompt = true;
    await page.locator('#prompt').fill('Remember mango');
    await page.locator('#send').click();
    await page.waitForFunction(() => document.querySelector('#delivery').textContent === 'Delivery not confirmed');
    const later = { ...repeated, id: 'later', items: repeated.items.map(item => ({ ...item, id: `later-${item.id}` })) };
    for (const res of streams) event(res, 'update', { ...state, turns: [later], removedTurnIds: [] });
    await page.waitForFunction(() => document.querySelector('[data-turn-id="later"]'));
    assert.equal(await page.locator('#delivery').textContent(), 'Delivery not confirmed', 'Failed prompt cannot match a future identical submission');
    assert.equal(await page.locator('#pending article').count(), 1);
    reject = true; for (const socket of streams) socket.close();
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'Invite is missing or revoked');
    assert(await page.locator('#send').isDisabled());
    assert.deepEqual(errors, []);
    console.log('Browser stream: WebSocket UTF-8 fragments, stable DOM, reading position, optimistic prompt, matched delivery, visible reply, reconnect and revocation passed');
  } finally {
    await browser.close(); for (const socket of streams) socket.close();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
