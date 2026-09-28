'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { CodexRPC } = require('../lib/codex-rpc');
const { startShare } = require('../lib/share-thread');
(async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'manycode-desktop-qa-'));
  const proof = path.resolve(process.env.MANYCODE_PROOF_DIR || path.join(project, 'proof'));
  fs.mkdirSync(proof, { recursive: true });
  const owner = new CodexRPC({ binary: process.env.MANYCODE_CODEX_BINARY || 'codex', args: ['app-server', '--listen', 'stdio://'] });
  const guest = new CodexRPC();
  let share, browser, tunnel;
  try {
    await owner.initialize(); await guest.initialize();
    const { thread } = await owner.request('thread/start', { cwd: project, approvalPolicy: 'never', sandbox: 'read-only', developerInstructions: 'Synthetic multiplayer test. Do not use tools. Reply exactly as requested.' });
    await owner.request('thread/name/set', { threadId: thread.id, name: 'Manycode backend acceptance test' });
    await owner.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'I am Alice. Remember the codename Mango. Reply exactly READY:Mango.' }] });
    share = await startShare({ rpc: guest, threadId: thread.id, guestName: 'Bob' });
    let address = share.address;
    if (process.argv.includes('--tunnel')) {
      tunnel = await require('../lib/host').startTunnel(share.server.address().port);
      assert(tunnel.url, tunnel.err); address = tunnel.url.replace('wss:', 'https:');
    }
    browser = await chromium.launch({ headless: true });
    const bob = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const observer = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const b = await bob.newPage(), v = await observer.newPage();
    await Promise.all([b.goto(`${address}/#${share.contributor}`), v.goto(`${address}/#${share.viewer}`)]);
    await b.waitForFunction(() => [...document.querySelectorAll('article[data-role=assistant]')].some(e => e.textContent.includes('READY:Mango')), null, { timeout: 90000 });
    await b.locator('#prompt').fill('I am Bob. What codename did Alice choose? Reply exactly BOB:Mango.');
    await b.locator('#send').click();
    await Promise.all([b.waitForFunction(() => [...document.querySelectorAll('article[data-role=assistant]')].some(e => e.textContent.includes('BOB:Mango')), null, { timeout: 90000 }), v.waitForFunction(() => [...document.querySelectorAll('article[data-role=assistant]')].some(e => e.textContent.includes('BOB:Mango')), null, { timeout: 90000 })]);
    assert(await v.locator('#composer').isHidden());
    const host = await owner.request('thread/read', { threadId: thread.id, includeTurns: true });
    assert(host.thread.turns.some(t => t.items.some(i => i.type === 'agentMessage' && i.text.includes('BOB:Mango'))));
    await b.screenshot({ path: path.join(proof, 'contributor.png'), fullPage: true });
    await v.screenshot({ path: path.join(proof, 'viewer.png'), fullPage: true });
    assert.equal((await fetch(address + '/conversation')).status, 401);
    share.revoke(share.contributor);
    assert.equal((await fetch(address + '/conversation', { headers: { authorization: `Bearer ${share.contributor}` } })).status, 401);
    fs.writeFileSync(path.join(proof, 'result.json'), JSON.stringify({ passed: true, threadId: thread.id, publicTunnel: !!tunnel, separateBackends: true, separateBrowserContexts: true, hostSawGuestReply: true, unauthorizedDenied: true, revokedDenied: true, desktopUIVerified: false }, null, 2));
    console.log(`PASS real Codex owner + independent queue backend + two browser contexts. Proof: ${proof}`);
  } finally { await browser?.close(); tunnel?.kill?.(); if (share) await share.close(); owner.close(); guest.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
