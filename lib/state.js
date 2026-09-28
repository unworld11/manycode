'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// One json file per live host session, keyed by pid. The menu bar helper
// and `ccshare code` read these; dead-pid files get swept on read.
const DIR = path.join(require('./paths').DIR, 'sessions');

function file(pid) {
  return path.join(DIR, pid + '.json');
}

function write(state) {
  try {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    const temporary = file(state.pid) + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, file(state.pid));
  } catch {}
}

function remove(pid) {
  try { fs.unlinkSync(file(pid)); } catch {}
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function list() {
  let entries;
  try { entries = fs.readdirSync(DIR); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.endsWith('.json')) continue;
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(DIR, e), 'utf8')); } catch { continue; }
    if (s && alive(s.pid)) out.push(s);
    else { try { fs.unlinkSync(path.join(DIR, e)); } catch {} }
  }
  return out.sort((a, b) => a.pid - b.pid);
}

module.exports = { write, remove, list };
