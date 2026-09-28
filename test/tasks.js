'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const WebSocket = require('ws');
const BIN = path.resolve(__dirname, '../bin/manycode.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manycode-tasks-'));
const cwd = path.join(root, 'project');
const stateDir = path.join(root, 'state');
fs.mkdirSync(cwd); fs.mkdirSync(stateDir);
fs.writeFileSync(path.join(stateDir, 'config.json'), JSON.stringify({ name: 'Owner', tunnel: false, menubar: false }));
const env = { ...process.env, MANYCODE_STATE_DIR: stateDir };
const processes = [], sockets = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
async function until(fn, label, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const result = fn(); if (result) return result; await delay(25); }
  throw new Error('Timed out: ' + label);
}
function run(args) {
  const p = spawn(process.execPath, [BIN, ...args], { cwd, env, stdio: 'pipe' });
  processes.push(p); p.output = ''; p.stderr.on('data', d => p.output += d); p.stdout.on('data', d => p.output += d);
  return p;
}
function states() {
  try { return fs.readdirSync(path.join(stateDir, 'sessions')).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(stateDir, 'sessions', f), 'utf8'))); } catch { return []; }
}
async function host(extra = []) {
  const p = run(['host', '--task', 'Build checkout', '--no-tunnel', '--no-menubar', '--no-chat-notify', '--port', '0', ...extra, 'bash', '-c', 'echo READY; exec cat']);
  const s = await until(() => states().find(s => s.pid === p.pid), 'host starts: ' + p.output);
  return { p, s, url: `ws://127.0.0.1:${s.port}` };
}
async function join(url, code, name, ownerToken) {
  const ws = new WebSocket(url); sockets.push(ws);
  const c = { ws, frames: [], output: '', task: null, id: null };
  ws.on('message', (d, binary) => {
    if (binary) { c.output += d; return; }
    const m = JSON.parse(d); c.frames.push(m);
    if (m.t === 'task') c.task = m.task;
    if (m.t === 'task-identity') c.id = m.id;
    if (m.t === 'replay') c.output += Buffer.from(m.d, 'base64');
  });
  ws.on('error', () => {});
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ t: 'join', code, name, ownerToken, cols: 80, rows: 24 }));
  await until(() => c.task && c.id, 'join ' + name);
  c.action = async (action, fields = {}, error) => {
    const requestId = Math.random().toString(36);
    ws.send(JSON.stringify({ t: 'task-action', action, requestId, ...fields }));
    const result = await until(() => c.frames.find(m => m.requestId === requestId), action);
    if (error) { assert.equal(result.t, 'task-error'); assert.match(result.msg, error); }
    else assert.equal(result.t, 'task-result', JSON.stringify(result));
    return result;
  };
  c.changes = async () => {
    const start = c.frames.length; ws.send(JSON.stringify({ t: 'task-changes' }));
    return until(() => c.frames.slice(start).find(m => m.t === 'task-changes'), 'changes');
  };
  return c;
}
async function stop(p) { p.kill('SIGTERM'); await until(() => p.exitCode !== null || p.signalCode !== null, 'stop'); }

(async () => {
  git('init'); git('config', 'user.name', 'Manycode Test'); git('config', 'user.email', 'test@example.invalid');
  fs.writeFileSync(path.join(cwd, 'checkout.txt'), 'before\n'); git('add', '.'); git('commit', '-m', 'fixture');
  fs.writeFileSync(path.join(cwd, '.env'), 'DEMO_SECRET=super-private-test-secret\n');
  fs.writeFileSync(path.join(cwd, '.gitignore'), '.env\n'); git('add', '.gitignore'); git('commit', '-m', 'ignore fixture secret');
  const { SharedTask } = require('../lib/task');
  const queue = new SharedTask({ title: 'Queue boundaries', cwd, hostName: 'Owner', persist: false });
  queue.join('a', 'Alice');
  queue.action('a', { action: 'instruct', text: 'do not send after revocation', requestId: 'revoked' });
  queue.action('host', { action: 'role', target: 'a', role: 'viewer' });
  await queue.deliverPrompt(() => { throw new Error('must not write'); });
  assert.equal(queue.data.prompts[0].status, 'failed');
  assert.match(queue.data.prompts[0].error, /access/);
  queue.action('host', { action: 'instruct', text: 'agent exit', requestId: 'exit' });
  await queue.deliverPrompt(() => { throw new Error('Agent has exited'); });
  assert.equal(queue.data.prompts[1].error, 'Agent has exited');
  for (let i = 0; i < 32; i++) queue.action('host', { action: 'instruct', text: 'queued ' + i, requestId: String(i) });
  assert.throws(() => queue.action('host', { action: 'instruct', text: 'overflow' }), /queue is full/);
  assert.throws(() => queue.action('host', { action: 'request-review' }), /queued prompts/);
  console.log('PASS queue boundaries: role revocation, failed writes, bounded queue, review waits for delivery');
  const { p, s, url } = await host();
  const owner = await join(url, s.code, 'Owner controls', s.ownerToken);
  const alice = await join(url, s.code, 'Alice');
  const bob = await join(url, s.code, 'Bob');
  assert.equal(owner.id, 'host'); assert.notEqual(alice.id, bob.id);
  alice.ws.send(Buffer.from('UNAUTHORIZED_KEYS\r'));
  await alice.action('instruct', { text: 'CONTRIBUTOR_PROMPT', from: 'Forged' });
  await until(() => bob.output.includes('CONTRIBUTOR_PROMPT'), 'contributor prompt without handoff');
  assert.equal(owner.task.prompts.find(p => p.text === 'CONTRIBUTOR_PROMPT').from, 'Alice');
  await alice.action('role', { target: bob.id, role: 'reviewer' }, /host/);
  await alice.action('feedback', { text: 'SUGGESTION_NOT_EXECUTED', anchor: 'checkout.txt:1', from: 'Forged' });
  await until(() => owner.task.feedback.length === 1, 'feedback broadcast');
  assert.equal(owner.task.feedback[0].from, 'Alice');
  await delay(150); assert(!bob.output.includes('UNAUTHORIZED_KEYS')); assert(!bob.output.includes('SUGGESTION_NOT_EXECUTED'));
  await owner.action('request-review', {}, /Resolve open feedback/);
  await owner.action('resolve-feedback', { feedbackId: owner.task.feedback[0].id, resolution: 'accepted' });
  await alice.action('request-control');
  await owner.action('handoff', { target: alice.id });
  await until(() => alice.task.driver === alice.id, 'handoff');
  p.stdin.write('HOST_MUST_NOT_TYPE\r');
  await alice.action('instruct', { text: 'DRIVER_INSTRUCTION' });
  await until(() => bob.output.includes('DRIVER_INSTRUCTION'), 'attributed instruction reaches real PTY');
  assert(!bob.output.includes('HOST_MUST_NOT_TYPE'));
  await owner.action('instruct', { text: 'OWNER_WITHOUT_CONTROL' });
  await until(() => bob.output.includes('OWNER_WITHOUT_CONTROL'), 'owner prompts without control');
  console.log('PASS task: shared prompting without handoff, attribution, raw-input gating, real PTY delivery');

  await Promise.all([
    alice.action('instruct', { text: 'PARALLEL_ALICE' }),
    bob.action('instruct', { text: 'PARALLEL_BOB' }),
  ]);
  await until(() => owner.task.prompts.filter(p => p.text.startsWith('PARALLEL_') && p.status === 'sent').length === 2, 'concurrent prompt delivery');
  const ordered = owner.task.prompts.filter(p => p.text.startsWith('PARALLEL_'));
  await until(() => owner.output.includes(ordered[1].text), 'all prompts visible');
  assert(owner.output.indexOf(ordered[0].text) < owner.output.indexOf(ordered[1].text));
  const duplicatePrompt = { t: 'task-action', action: 'instruct', text: 'ONCE_ONLY', requestId: 'repeat-one' };
  alice.ws.send(JSON.stringify(duplicatePrompt)); alice.ws.send(JSON.stringify(duplicatePrompt));
  await until(() => owner.task.prompts.some(p => p.text === 'ONCE_ONLY' && p.status === 'sent'), 'idempotent delivery');
  assert.equal(owner.task.prompts.filter(p => p.text === 'ONCE_ONLY').length, 1);
  console.log('PASS prompt queue: concurrent contributors, server order, duplicate request suppression');

  await owner.action('role', { target: bob.id, role: 'reviewer' });
  fs.writeFileSync(path.join(cwd, 'checkout.txt'), 'after\n');
  await alice.action('request-review');
  const changes = await bob.changes();
  assert(changes.diff.includes('+after'));
  await alice.action('approve', { revision: changes.revision }, /reviewers/);
  await alice.action('complete', { revision: changes.revision }, /reviewer must approve/);
  await bob.action('approve', { revision: 'old' }, /Refresh/);
  await bob.action('approve', { revision: changes.revision });
  fs.writeFileSync(path.join(cwd, 'checkout.txt'), 'changed after approval\n');
  await alice.action('complete', { revision: changes.revision }, /Changes changed/);
  await until(() => alice.task.status === 'working', 'invalidates stale approval');
  await alice.action('request-review');
  const fresh = await bob.changes();
  await bob.action('approve', { revision: fresh.revision });
  await alice.action('complete', { revision: fresh.revision });
  await until(() => owner.task.status === 'complete', 'completion broadcasts');
  assert(owner.task.events.some(e => e.kind === 'approved' && e.from === 'Bob'));
  await alice.action('instruct', { text: 'POST_COMPLETE' }, /working/);
  console.log('PASS review: exact diff, designated reviewer, stale approval rejection, completion gate');

  await alice.action('working');
  await alice.action('update', { goal: 'Mask super-private-test-secret in shared state' });
  await until(() => bob.task.goal.includes('Mask'), 'redacted task');
  assert(!JSON.stringify(bob.task).includes('super-private-test-secret'));
  await owner.action('role', { target: bob.id, role: 'viewer' });
  await bob.action('feedback', { text: 'viewer mutation' }, /Viewers/);
  await bob.action('instruct', { text: 'VIEWER_PROMPT' }, /Viewers/);
  assert(!bob.output.includes('VIEWER_PROMPT'));
  await owner.action('handoff', { target: bob.id }, /contributor/);
  alice.ws.close(); await until(() => owner.task.driver === 'host', 'driver disconnect returns control');
  const late = await join(url, s.code, 'Late teammate');
  assert(late.task.events.some(e => e.kind === 'instruction'));
  assert.equal(late.task.feedback[0].status, 'accepted');
  assert.equal(late.task.members.find(m => m.id === late.id).role, 'contributor');
  console.log('PASS roles, disconnect recovery, late-join catch-up, secret redaction');

  const duplicate = run(['host', '--resume-task', s.taskId, '--no-tunnel', '--no-menubar', 'cat']);
  await until(() => duplicate.exitCode !== null, 'duplicate host rejects');
  assert.match(duplicate.output, /already hosted/);
  await stop(p);
  const saved = JSON.parse(fs.readFileSync(path.join(stateDir, 'tasks', s.taskId + '.json'), 'utf8'));
  assert(saved.events.some(e => e.kind === 'instruction'));
  const resumed = run(['host', '--resume-task', s.taskId, '--no-tunnel', '--no-menubar', '--port', '0', 'cat']);
  const resumedState = await until(() => states().find(x => x.pid === resumed.pid), 'resume');
  const resumedClient = await join(`ws://127.0.0.1:${resumedState.port}`, resumedState.code, 'Rejoin');
  assert.equal(resumedClient.task.id, s.taskId); assert.equal(resumedClient.task.status, 'working');
  assert(resumedClient.task.events.some(e => e.kind === 'resumed'));
  await stop(resumed);
  console.log('PASS persistence: concurrent host lock, saved history, resume after process exit');

  const net = require('net'); const probe = net.createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r)); const relayPort = probe.address().port; await new Promise(r => probe.close(r));
  const relay = run(['relay', '--port', String(relayPort)]);
  await until(() => relay.output.includes('listening'), 'relay listening');
  const relayUrl = `ws://127.0.0.1:${relayPort}`;
  const rh = await host(['--relay', relayUrl]);
  const ro = await join(rh.url, rh.s.code, 'Owner', rh.s.ownerToken);
  const ra = await join(relayUrl, rh.s.code, 'Relay Alice');
  const rb = await join(relayUrl, rh.s.code, 'Relay Bob');
  await ro.action('handoff', { target: ra.id });
  rb.ws.send(Buffer.from('RELAY_BLOCKED\r'));
  rb.ws.send(JSON.stringify({ t: 'input', id: ra.id, d: Buffer.from('SPOOFED_INPUT\r').toString('base64') }));
  rb.ws.send(JSON.stringify({ t: 'joined', id: ra.id, name: 'Spoof' }));
  ra.ws.send(Buffer.from('RELAY_ALLOWED\r'));
  await until(() => rb.output.includes('RELAY_ALLOWED'), 'relay driver raw input');
  assert(!rb.output.includes('RELAY_BLOCKED')); assert(!rb.output.includes('SPOOFED_INPUT'));
  await rb.action('instruct', { text: 'RELAY_SHARED_PROMPT', id: ra.id, from: 'Forged' });
  await until(() => ra.output.includes('RELAY_SHARED_PROMPT'), 'relay contributor prompt');
  assert.equal(ro.task.prompts.find(p => p.text === 'RELAY_SHARED_PROMPT').from, 'Relay Bob');
  assert.equal(ro.task.members.find(m => m.id === ra.id).name, 'Relay Alice');
  await stop(rh.p); await stop(relay);
  console.log('PASS relay: stamped input identity, single-driver enforcement, forged control rejection');

  const readOnly = await host(['--read-only']);
  const observer = await join(readOnly.url, readOnly.s.code, 'Observer');
  await observer.action('instruct', { text: 'READ_ONLY_BLOCKED' }, /read-only/);
  assert(!observer.output.includes('READ_ONLY_BLOCKED'));
  await stop(readOnly.p);
  console.log('PASS read-only session rejects contributor prompts');

  const detached = run(['host', '--detach', '--task', 'Keep working', '--no-tunnel', '--no-menubar', '--port', '0', 'cat']);
  await until(() => detached.exitCode !== null, 'detached launcher exits');
  assert.equal(detached.exitCode, 0, detached.output);
  const ds = states().find(x => x.taskTitle === 'Keep working'); assert(ds); process.kill(ds.pid, 0);
  const dc = await join(`ws://127.0.0.1:${ds.port}`, ds.code, 'Owner', ds.ownerToken);
  await dc.action('instruct', { text: 'AFTER_LAUNCHER_EXIT' });
  await until(() => dc.output.includes('AFTER_LAUNCHER_EXIT'), 'detached agent stays alive');
  process.kill(ds.pid, 'SIGTERM');
  console.log('PASS detached hosting: launcher exits, task accepts instructions afterward');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  for (const ws of sockets) ws.terminate();
  for (const p of processes) if (p.exitCode === null && p.signalCode === null) p.kill('SIGTERM');
  for (const s of states()) { try { process.kill(s.pid, 'SIGTERM'); } catch {} }
  await delay(200);
  fs.rmSync(root, { recursive: true, force: true });
});
