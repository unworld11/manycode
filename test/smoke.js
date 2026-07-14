'use strict';
// End-to-end smoke test: host a bash session instead of claude, join it over
// ws (direct + relay), type into it remotely, check the output comes back.
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const BIN = path.join(__dirname, '..', 'bin', 'ccshare.js');
let failures = 0;

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function collectUntil(ws, needle, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let acc = '';
    const to = setTimeout(() => reject(new Error(`timeout waiting for ${JSON.stringify(needle)}; got: ${JSON.stringify(acc.slice(-300))}`)), timeoutMs);
    ws.on('message', (data, isBinary) => {
      if (isBinary) acc += data.toString('utf8');
      else {
        const m = JSON.parse(data);
        if (m.t === 'replay' && m.d) acc += Buffer.from(m.d, 'base64').toString('utf8');
        if (m.t === 'err') { clearTimeout(to); reject(new Error('err: ' + m.msg)); }
      }
      if (acc.includes(needle)) { clearTimeout(to); resolve(acc); }
    });
  });
}

function joinWs(url, code, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const to = setTimeout(() => reject(new Error('join timeout')), 5000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', code, name, cols: 100, rows: 30 })));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const m = JSON.parse(data);
      if (m.t === 'ok') { clearTimeout(to); resolve(ws); }
      if (m.t === 'err') { clearTimeout(to); reject(new Error('join rejected: ' + m.msg)); }
    });
    ws.on('error', (e) => { clearTimeout(to); reject(e); });
  });
}

async function testDirect() {
  const host = spawn('node', [
    BIN, 'host', '--no-relay', '--no-menubar', '--port', '45999', '--code', 'TEST42',
    '--cmd', 'bash', '--', '-c', 'echo MARKER_READY; exec cat',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    await wait(1200);
    const ws = await joinWs('ws://127.0.0.1:45999', 'TEST42', 'tester');
    const seen = collectUntil(ws, 'MARKER_HELLO');
    await collectUntil(ws, 'MARKER_READY', 4000); // replay carries startup output
    ws.send(Buffer.from('echo-me MARKER_HELLO\r'));
    await seen;
    ws.send(JSON.stringify({ t: 'resize', cols: 90, rows: 28 })); // must not crash
    await wait(300);
    // wrong code gets rejected
    await joinWs('ws://127.0.0.1:45999', 'WRONG1', 'x').then(
      () => { throw new Error('wrong code was accepted'); },
      () => {},
    );
    ws.close();
    console.log('PASS direct: join, replay, remote typing, resize, bad-code reject');
  } catch (e) {
    failures++;
    console.log('FAIL direct: ' + e.message);
  } finally {
    host.kill('SIGKILL');
  }
}

async function testRelay() {
  const relay = spawn('node', [BIN, 'relay', '--port', '45998'], { stdio: 'pipe' });
  let host = null;
  try {
    await wait(600);
    host = spawn('node', [
      BIN, 'host', '--relay', 'ws://127.0.0.1:45998', '--no-menubar', '--port', '45997', '--code', 'TEST43',
      '--cmd', 'bash', '--', '-c', 'echo MARKER_READY; exec cat',
    ], { stdio: 'pipe' });
    await wait(1500);
    const ws = await joinWs('ws://127.0.0.1:45998', 'TEST43', 'remote-friend');
    const seen = collectUntil(ws, 'MARKER_WORLD');
    await collectUntil(ws, 'MARKER_READY', 4000);
    ws.send(Buffer.from('echo-me MARKER_WORLD\r'));
    await seen;
    ws.close();
    console.log('PASS relay: hosted code, join through relay, replay, remote typing');
  } catch (e) {
    failures++;
    console.log('FAIL relay: ' + e.message);
  } finally {
    if (host) host.kill('SIGKILL');
    relay.kill('SIGKILL');
  }
}

(async () => {
  await testDirect();
  await testRelay();
  process.exit(failures ? 1 : 0);
})();
