'use strict';
// Edge-case regressions: input validation and code normalization.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const BIN = path.join(__dirname, '..', 'bin', 'manycode.js');
let failures = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, ok, detail) {
  if (ok) console.log('PASS ' + name);
  else { failures++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); }
}

function run(args, opts = {}) {
  const p = spawn('node', [BIN, ...args], { stdio: 'pipe', ...opts });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  return { p, out: () => out };
}

// join and report the sequence of control messages ('hold', 'ok', 'err:…')
function joinTrace(port, code, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const seen = [];
    const done = () => { try { ws.close(); } catch {} resolve(seen); };
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', code, name: 'edge', cols: 80, rows: 24 })));
    ws.on('message', (d, bin) => {
      if (bin) return;
      const m = JSON.parse(d);
      seen.push(m.t === 'err' ? 'err:' + m.msg : m.t);
      if (m.t === 'ok' || m.t === 'err') done();
    });
    ws.on('error', () => done());
    setTimeout(done, timeoutMs);
  });
}

(async () => {
  // punctuated/lowercase --code still matches a normalized joiner
  const h = run(['host', '--no-relay', '--no-menubar', '--no-tunnel', '--port', '45979', '--code', '7kq-2fm', 'bash', '-c', 'sleep 3']);
  await wait(1200);
  const ws = new WebSocket('ws://127.0.0.1:45979');
  const res = await new Promise((resolve) => {
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', code: '7KQ2FM', name: 'x', cols: 80, rows: 24 })));
    ws.on('message', (d, bin) => { if (!bin) resolve(JSON.parse(d).t); });
    ws.on('error', () => resolve('conn-error'));
    setTimeout(() => resolve('timeout'), 3000);
  });
  check('normalized --code matches joiner', res === 'ok', res);
  ws.close();
  h.p.kill('SIGKILL');

  // bad numeric flags die with a readable message
  const p1 = run(['host', '--port', 'abc']);
  await wait(900);
  check('--port abc rejected clearly', p1.out().includes('--port must be a number'), p1.out().trim().slice(0, 80));
  p1.p.kill('SIGKILL');

  // too-short custom code rejected
  const p2 = run(['host', '--no-relay', '--no-menubar', '--no-tunnel', '--code', 'AB', 'bash', '-c', 'true']);
  await wait(900);
  check('--code AB rejected clearly', p2.out().includes('4-12'), p2.out().trim().slice(0, 80));
  p2.p.kill('SIGKILL');

  // missing agent binary gets a helpful error, not a pty crash
  const p3 = run(['host', '--no-relay', '--no-menubar', '--no-tunnel', 'definitely-not-a-real-agent']);
  await wait(900);
  check('missing agent explained', p3.out().includes('not found - is it installed'), p3.out().trim().slice(0, 90));
  p3.p.kill('SIGKILL');

  // version prints the package version
  const p4 = run(['version']);
  await wait(500);
  check('version prints a number', /manycode \d+\.\d+\.\d+/.test(p4.out()), p4.out().trim().slice(0, 60));

  // stop with no sessions is a clean message, not a crash
  const p5 = run(['stop']);
  await wait(500);
  check('stop with no sessions is clean', p5.out().includes('no active sessions'), p5.out().trim().slice(0, 60));

  // stop <code> ends a running host from another process
  const h2 = run(['host', '--no-relay', '--no-menubar', '--no-tunnel', '--port', '45978', '--code', 'STOPME', 'bash', '-c', 'sleep 30']);
  await wait(1200);
  const stopper = run(['stop', 'STOPME']);
  const stopped = await new Promise((resolve) => {
    h2.p.on('exit', () => resolve(true));
    setTimeout(() => resolve(false), 3000);
  });
  check('stop <code> ends the host', stopped, stopper.out().trim().slice(0, 60));
  if (!stopped) h2.p.kill('SIGKILL');

  // plain GET on the ws port serves the browser join page
  const h3 = run(['host', '--no-relay', '--no-menubar', '--no-tunnel', '--port', '45977', '--code', 'WEBB42', 'bash', '-c', 'sleep 10']);
  await wait(1200);
  const page = await new Promise((resolve) => {
    http.get('http://127.0.0.1:45977/', (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', () => resolve({ status: 0, body: '' }));
  });
  check('browser join page served', page.status === 200 && page.body.includes('xterm') && page.body.includes('manycode'),
    `status ${page.status}`);
  h3.p.kill('SIGKILL');

  // --approve: joiner is held, then let in / declined per the host's answer
  const env = (v) => ({ env: { ...process.env, CCSHARE_APPROVE_TEST: v } });
  const h4 = run(['host', '--no-relay', '--no-menubar', '--no-tunnel', '--port', '45976', '--code', 'APPR42', '--approve', 'bash', '-c', 'sleep 15'], env('allow'));
  await wait(1200);
  const allowed = await joinTrace(45976, 'APPR42');
  check('approve: allowed joiner held then admitted', allowed.join(',') === 'hold,ok', allowed.join(','));
  h4.p.kill('SIGKILL');

  const h5 = run(['host', '--no-relay', '--no-menubar', '--no-tunnel', '--port', '45975', '--code', 'DENY42', '--approve', 'bash', '-c', 'sleep 15'], env('deny'));
  await wait(1200);
  const denied = await joinTrace(45975, 'DENY42');
  check('approve: denied joiner told so', denied.join(',') === 'hold,err:the host declined', denied.join(','));
  h5.p.kill('SIGKILL');

  // chat: A's message reaches B (not echoed to A), late joiner C gets the log
  const h7 = run(['host', '--no-relay', '--no-menubar', '--no-tunnel', '--port', '45973', '--code', 'CHAT42', 'bash', '-c', 'sleep 20']);
  await wait(1200);
  const joinChat = (name) => new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:45973');
    const got = { chats: [], logs: [] };
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', code: 'CHAT42', name, cols: 80, rows: 24 })));
    ws.on('message', (d, bin) => {
      if (bin) return;
      const m = JSON.parse(d);
      if (m.t === 'ok') resolve({ ws, got });
      if (m.t === 'chat') got.chats.push(m);
      if (m.t === 'chatlog') got.logs.push(...m.msgs);
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('join timeout')), 4000);
  });
  const A = await joinChat('alice');
  const B = await joinChat('bob');
  A.ws.send(JSON.stringify({ t: 'chat', text: 'hello from alice' }));
  await wait(700);
  check('chat: B hears A with stamped name',
    B.got.chats.length === 1 && B.got.chats[0].from === 'alice' && B.got.chats[0].text === 'hello from alice',
    JSON.stringify(B.got.chats));
  check('chat: A is not echoed her own message', A.got.chats.length === 0, JSON.stringify(A.got.chats));
  const C = await joinChat('carol');
  await wait(500);
  check('chat: late joiner gets the log', C.got.logs.some((m) => m.text === 'hello from alice'), JSON.stringify(C.got.logs));
  A.ws.close(); B.ws.close(); C.ws.close();
  h7.p.kill('SIGKILL');

  // secrets guard: .env values masked for joiners by default, raw with --share-secrets
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manycode-env-'));
  fs.writeFileSync(path.join(envDir, '.env'), 'API_KEY=supersecretvalue123\nPORT=3000\n# comment\n');
  for (const [label, flag, wantMasked] of [
    ['masked by default', [], true],
    ['raw with --share-secrets', ['--share-secrets'], false],
  ]) {
    const hp = run(['host', '--no-relay', '--no-menubar', '--no-tunnel', '--port', '45972', '--code', 'SECR42', ...flag,
      'bash', '-c', 'echo key is supersecretvalue123; sleep 10'], { cwd: envDir });
    await wait(1500);
    const seen = await new Promise((resolve) => {
      const ws = new WebSocket('ws://127.0.0.1:45972');
      let acc = '';
      ws.on('open', () => ws.send(JSON.stringify({ t: 'join', code: 'SECR42', name: 'peek', cols: 80, rows: 24 })));
      ws.on('message', (d, bin) => {
        if (bin) { acc += d.toString('utf8'); return; }
        const m = JSON.parse(d);
        if (m.t === 'replay' && m.d) acc += Buffer.from(m.d, 'base64').toString('utf8');
      });
      setTimeout(() => { try { ws.close(); } catch {} resolve(acc); }, 2500);
    });
    const masked = !seen.includes('supersecretvalue123') && seen.includes('••••••');
    check(`secrets: ${label}`, wantMasked ? masked : seen.includes('supersecretvalue123'),
      `saw: ${JSON.stringify(seen.slice(0, 120))}`);
    hp.p.kill('SIGKILL');
    await wait(300);
  }
  fs.rmSync(envDir, { recursive: true, force: true });

  // --record: cast file with a v2 header and the session output, saved on SIGTERM
  const recDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manycode-rec-'));
  const h6 = run(['host', '--no-relay', '--no-menubar', '--no-tunnel', '--port', '45974', '--code', 'RECC42', '--record', 'bash', '-c', 'echo MARKER_CAST; sleep 15'], { cwd: recDir });
  await wait(2000);
  h6.p.kill('SIGTERM');
  await wait(600);
  const casts = fs.readdirSync(recDir).filter((f) => f.endsWith('.cast'));
  let castOk = false, castDetail = 'no .cast file';
  if (casts.length === 1) {
    const cast = fs.readFileSync(path.join(recDir, casts[0]), 'utf8').split('\n').filter(Boolean);
    const head = JSON.parse(cast[0]);
    castOk = head.version === 2 && head.width > 0 && cast.slice(1).some((l) => l.includes('MARKER_CAST'));
    castDetail = `header ${JSON.stringify(head).slice(0, 60)}, ${cast.length} lines`;
  }
  check('record: asciinema cast written', castOk, castDetail);
  fs.rmSync(recDir, { recursive: true, force: true });

  process.exit(failures ? 1 : 0);
})();
