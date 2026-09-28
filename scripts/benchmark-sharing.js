'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const proof = path.join(root, 'artifacts/speed-test');

async function measure(label, startShare) {
  const thread = { id: 'speed-test', name: 'Speed test', turns: Array.from({ length: 100 }, (_, i) => ({ id: `history-${i}`, status: 'completed', items: [{ type: 'agentMessage', id: `history-message-${i}`, text: `History ${i}: ` + 'Earlier conversation. '.repeat(100) }] })) };
  let reads = 0, wireBytes = 0;
  const rpc = { async request(method) {
    if (method === 'thread/read') { reads++; return { thread: structuredClone(thread) }; }
    if (method === 'thread/queue/list') return { data: [] };
    throw new Error(`Unexpected method: ${method}`);
  } };
  const share = await startShare({ rpc, threadId: thread.id });
  share.server.prependListener('request', (req, res) => {
    if (!['/conversation', '/events'].includes(req.url)) return;
    for (const method of ['write', 'end']) {
      const original = res[method];
      res[method] = function (chunk, ...args) { if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) wireBytes += Buffer.byteLength(chunk); return original.call(this, chunk, ...args); };
    }
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const pages = await Promise.all([browser.newPage(), browser.newPage()]);
    for (const page of pages) page.on('websocket', socket => socket.on('framereceived', ({ payload }) => { wireBytes += Buffer.byteLength(payload); }));
    await Promise.all(pages.map((p, i) => p.goto(`${share.address}/#${i ? share.viewer : share.contributor}`)));
    await Promise.all(pages.map(p => p.waitForFunction(() => document.querySelectorAll('article[data-role=assistant]').length === 100)));
    wireBytes = 0; reads = 0;
    const samples = [];
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, [80, 210, 430, 90, 330, 170][i]));
      const marker = `SPEED-UPDATE-${i}`;
      const started = performance.now();
      thread.turns.push({ id: `new-${i}`, status: 'completed', items: [{ type: 'agentMessage', id: `new-message-${i}`, text: marker }] });
      await Promise.all(pages.map(p => p.waitForFunction(text => [...document.querySelectorAll('article[data-role=assistant]')].some(e => e.textContent.includes(text)), marker, { polling: 10, timeout: 5000 })));
      samples.push(Math.round(performance.now() - started));
    }
    const result = { label, samplesMs: samples, averageMs: Math.round(samples.reduce((a,b)=>a+b,0)/samples.length), maxMs: Math.max(...samples), wireBytes, backendReads: reads, viewers: 2, historyTurns: 100 };
    await pages[0].screenshot({ path: path.join(proof, `${label}.png`) });
    return result;
  } finally { await browser.close(); await share.close(); }
}
(async () => {
  fs.mkdirSync(proof, { recursive: true });
  const baselineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manycode-baseline-'));
  try {
    for (const name of ['share-thread.js','share-thread.html','share-thread-client.js']) {
      let source = execFileSync('git', ['show', `29d51f37740fa86d988282cda40d1805a537c06f:lib/${name}`], { cwd: root, encoding:'utf8' });
      if (name.endsWith('.js')) source = source.replace("require('./codex-rpc')", `require(${JSON.stringify(path.join(root,'lib/codex-rpc'))})`);
      fs.writeFileSync(path.join(baselineDir,name),source);
    }
    const baseline = await measure('baseline',require(path.join(baselineDir,'share-thread')).startShare);
    const current = await measure('streaming',require('../lib/share-thread').startShare);
    const result = { environment:'Local real Chromium browsers, deterministic backend; excludes model and desktop queue delay', baseline, current, speedup: Number((baseline.averageMs/current.averageMs).toFixed(2)), trafficReductionPercent: Number((100*(1-current.wireBytes/baseline.wireBytes)).toFixed(2)) };
    fs.writeFileSync(path.join(proof,'benchmark.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
    assert(current.averageMs < baseline.averageMs, 'Streaming must improve delivery latency');
    assert(current.wireBytes < baseline.wireBytes / 2, 'Streaming must avoid retransmitting full history');
  } finally { fs.rmSync(baselineDir,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
