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
    console.log('Created synthetic test conversation.');
    await owner.request('thread/name/set', { threadId: thread.id, name: 'Manycode backend acceptance test' });
    await owner.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'I am Alice. Remember the codename Mango. Reply exactly READY:Mango.' }] });
    share = await startShare({ rpc: guest, threadId: thread.id, guestName: 'Bob' });
    let address = share.address;
    if (process.argv.includes('--tunnel')) {
      tunnel = await require('../lib/host').startTunnel(share.server.address().port);
      assert(tunnel.url, tunnel.err); address = tunnel.url.replace('wss:', 'https:');
    }
    const browserArgs = [];
    if (tunnel) {
      const resolver = new (require('dns').promises.Resolver)();
      resolver.setServers(['1.1.1.1', '8.8.8.8']);
      const hostname = new URL(address).hostname;
      let addresses;
      for (let attempt = 0; attempt < 12; attempt++) {
        try { addresses = await resolver.resolve4(hostname); break; }
        catch (error) { if (attempt === 11) throw error; await new Promise(resolve => setTimeout(resolve, 2500)); }
      }
      browserArgs.push(`--host-resolver-rules=MAP ${hostname} ${addresses[0]}`);
    }
    browser = await chromium.launch({ headless: true, args: browserArgs });
    const bob = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const observer = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const b = await bob.newPage(), v = await observer.newPage();
    await Promise.all([b.goto(`${address}/#${share.contributor}`), v.goto(`${address}/#${share.viewer}`)]);
    await b.waitForFunction(() => [...document.querySelectorAll('article[data-role=assistant]')].some(e => e.textContent.includes('READY:Mango')), null, { timeout: 90000 });
    console.log('Public browsers received the owner response.');
    await b.locator('#prompt').fill('I am Bob. What codename did Alice choose? Reply exactly BOB:Mango.');
    const submittedAt = Date.now();
    await b.locator('#send').click();
    await Promise.all([b.waitForFunction(() => [...document.querySelectorAll('article[data-role=assistant]')].some(e => e.textContent.includes('BOB:Mango')), null, { timeout: 90000 }), v.waitForFunction(() => [...document.querySelectorAll('article[data-role=assistant]')].some(e => e.textContent.includes('BOB:Mango')), null, { timeout: 90000 })]);
    const guestReplyMs = Date.now() - submittedAt;
    console.log(`Browser guest replied in ${guestReplyMs}ms, including desktop pickup and model response.`);
    const { promisify } = require('util');
    const execFile = promisify(require('child_process').execFile);
    const remote = args => execFile(process.execPath, [path.join(__dirname, '../bin/manycode.js'), 'remote', ...args], { env: { ...process.env, MANYCODE_STATE_DIR: path.join(project, 'guest-state') } });
    await remote(['connect', `${share.address}/#${share.contributor}`]);
    await remote(['prompt', 'From my own coding app, what codename was chosen? Reply exactly CLI:Mango.']);
    await b.waitForFunction(() => [...document.querySelectorAll('article[data-role=assistant]')].some(e => e.textContent.includes('CLI:Mango')), null, { timeout: 90000 });
    const cliRead = await remote(['read', '--json']);
    assert(JSON.parse(cliRead.stdout).turns.some(t => t.items.some(i => i.role === 'assistant' && i.text.includes('CLI:Mango'))));
    await remote(['disconnect']);
    console.log('Guest CLI read and prompt reached the same real conversation.');
    assert(await v.locator('#composer').isHidden());
    const host = await owner.request('thread/read', { threadId: thread.id, includeTurns: true });
    assert(host.thread.turns.some(t => t.items.some(i => i.type === 'agentMessage' && i.text.includes('BOB:Mango'))));
    await b.screenshot({ path: path.join(proof, 'contributor.png'), fullPage: true });
    await v.screenshot({ path: path.join(proof, 'viewer.png'), fullPage: true });
    assert.equal(await b.evaluate(async () => (await fetch('/conversation')).status), 401);
    share.revoke(share.contributor);
    assert.equal(await b.evaluate(async token => (await fetch('/conversation', { headers: { authorization: `Bearer ${token}` } })).status, share.contributor), 401);
    fs.writeFileSync(path.join(proof, 'result.json'), JSON.stringify({ passed: true, threadId: thread.id, publicTunnel: !!tunnel, separateBackends: true, separateBrowserContexts: true, hostSawGuestReply: true, unauthorizedDenied: true, revokedDenied: true, desktopUIVerified: false, guestCLIReadPromptVerified: true, guestCLITransport: 'loopback', guestReplyMs, publicDNSFallback: !!tunnel }, null, 2));
    console.log(`PASS real Codex owner + independent queue backend + two browser contexts. Proof: ${proof}`);
  } finally { await browser?.close(); tunnel?.kill?.(); if (share) await share.close(); owner.close(); guest.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
