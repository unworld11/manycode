'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const state = require('./state');
const { DIR } = require('./paths');
const { normalizeCode } = require('./codes');

async function detach(args) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const log = path.join(DIR, `host-${Date.now()}.log`);
  const fd = fs.openSync(log, 'wx', 0o600);
  const childArgs = args.slice();
  childArgs.splice(childArgs.indexOf('--detach'), 1);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin/manycode.js'), 'host', ...childArgs], {
    detached: true, stdio: ['ignore', fd, fd], env: process.env,
  });
  fs.closeSync(fd);
  child.unref();
  let error;
  child.on('error', e => { error = e; });
  for (let i = 0; i < 100; i++) {
    if (error) throw error;
    const session = state.list().find(s => s.pid === child.pid);
    if (session) {
      const attach = session.taskId ? 'manycode task open' : `manycode join ${session.code} --host 127.0.0.1:${session.port}`;
      console.log(`manycode: running in background · ${session.code}\n${session.browser || ''}\nUse ${attach} to drive it. Log: ${log}`);
      return;
    }
    if (child.exitCode !== null) throw new Error(`Host exited. Read ${log}`);
    await new Promise(r => setTimeout(r, 150));
  }
  child.kill('SIGTERM');
  throw new Error(`Host startup timed out. Read ${log}`);
}

async function run(action, opts) {
  const matches = state.list().filter(s => s.taskId && (!opts.code || s.code === normalizeCode(opts.code)));
  if (matches.length !== 1) throw new Error(matches.length ? 'Several tasks are live. Select one with --code CODE' : 'No matching live task. Use manycode tasks to see saved work');
  const s = matches[0];
  if (action === 'open') {
    const url = `http://127.0.0.1:${s.port}/#${s.code}:${s.ownerToken}`;
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
    await new Promise((resolve, reject) => {
      const p = spawn(command, [url], { stdio: 'ignore' });
      p.once('error', reject); p.once('exit', code => code === 0 ? resolve() : reject(new Error('Could not open browser')));
    });
    return;
  }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}`);
    let sent = false;
    let finished = false;
    const timer = setTimeout(() => finish(new Error('Task request timed out')), 8000);
    function finish(error, result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer); ws.close();
      if (error) reject(error); else { console.log(JSON.stringify(result, null, 2)); resolve(); }
    }
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', code: s.code, ownerToken: s.ownerToken, name: 'host controls' })));
    ws.on('message', (data, binary) => {
      if (binary) return;
      const m = JSON.parse(data);
      if (m.t === 'task' && !sent) {
        sent = true;
        if (action === 'show' || action === 'catch-up') return finish(null, m.task);
        const { _, code, ...fields } = opts;
        ws.send(JSON.stringify({ ...fields, t: action === 'changes' ? 'task-changes' : 'task-action', action }));
      } else if (m.t === 'task-error' || m.t === 'err') finish(new Error(m.msg));
      else if (m.t === 'task-result' || m.t === 'task-changes') finish(null, m);
    });
    ws.on('error', e => finish(e));
  });
}
module.exports = { detach, run };
