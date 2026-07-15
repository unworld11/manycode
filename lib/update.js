'use strict';
const { spawn, spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Installs are git clones, so "update" is git pull + npm i. Hosts/joins kick
// off a background freshness check; the result is cached and surfaced in the
// next banner, so nothing ever blocks on the network.
const ROOT = path.join(__dirname, '..');
const CACHE = path.join(os.homedir(), '.ccshare', 'update.json');

function localHead() {
  try {
    return execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function checkInBackground() {
  try {
    const cp = spawn('git', ['-C', ROOT, 'ls-remote', 'origin', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    cp.stdout.on('data', (d) => { out += d; });
    cp.on('exit', (code) => {
      if (code !== 0) return;
      const remote = out.split(/\s/)[0];
      const local = localHead();
      if (!remote || !local) return;
      try {
        fs.mkdirSync(path.dirname(CACHE), { recursive: true });
        fs.writeFileSync(CACHE, JSON.stringify({ remote, local, behind: remote !== local, at: Date.now() }));
      } catch {}
    });
    cp.on('error', () => {});
    setTimeout(() => { try { cp.kill(); } catch {} }, 10000);
  } catch {}
}

function cachedBehind() {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    if (!c.behind) return false;
    // the cache is only trustworthy if HEAD hasn't moved since it was written
    return c.local === localHead();
  } catch {
    return false;
  }
}

function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// CHANGELOG.md sections newer than the version we came from - each bullet
// opens with a bold headline, which is exactly the right length to echo here
function whatsNew(oldVer) {
  let md;
  try { md = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'); } catch { return []; }
  const out = [];
  for (const s of md.split(/^## /m).slice(1)) {
    const ver = s.split('\n', 1)[0].trim();
    if (!/^\d+\.\d+\.\d+$/.test(ver) || cmpVer(ver, oldVer) <= 0) continue;
    const heads = [...s.matchAll(/^- \*\*(.+?)\*\*/gm)].map((m) => m[1].replace(/\.$/, ''));
    if (heads.length) out.push({ ver, heads });
  }
  return out; // newest first, like the file
}

function runUpdate() {
  const readVer = () => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; }
  };
  const git = (args) => spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
  const say = (s) => process.stderr.write(s);

  const oldVer = readVer();
  const oldHead = localHead() || '';
  say('ccshare: checking github…\n');
  const fetch = git(['fetch', 'origin']);
  if (fetch.status !== 0) {
    say('ccshare: could not reach github - are you online?\n');
    const tail = String(fetch.stderr || '').trim().split('\n').slice(-2);
    for (const l of tail) if (l) say('  ' + l + '\n');
    process.exit(1);
  }
  const remote = (git(['rev-parse', 'origin/master']).stdout || '').trim();
  if (remote && remote === oldHead) {
    try { fs.unlinkSync(CACHE); } catch {}
    say(`ccshare: you're on the latest already (${oldVer}, ${oldHead.slice(0, 7)})\n`);
    process.exit(0);
  }

  // npm install rewrites the lockfile; drop that noise so the pull is clean
  git(['checkout', '--', 'package-lock.json']);
  const dirty = (git(['status', '--porcelain']).stdout || '').trim();
  if (dirty) {
    say(`ccshare: you have local changes in ${ROOT} - stash or commit them, then rerun:\n`);
    for (const l of dirty.split('\n').slice(0, 8)) say('  ' + l + '\n');
    process.exit(1);
  }
  const merge = git(['merge', '--ff-only', 'origin/master']);
  if (merge.status !== 0) {
    say('ccshare: your copy has diverged from github. if you have no local work worth keeping:\n');
    say(`  git -C ${ROOT} reset --hard origin/master && ccshare update\n`);
    process.exit(1);
  }

  say('ccshare: installing dependencies…\n');
  const install = spawnSync('npm', ['i', '--no-fund', '--no-audit'], { cwd: ROOT, encoding: 'utf8' });
  if (install.status !== 0) {
    say('ccshare: npm install failed:\n');
    const tail = String(install.stderr || install.stdout || '').trim().split('\n').slice(-10);
    for (const l of tail) say('  ' + l + '\n');
    process.exit(install.status || 1);
  }
  try { fs.unlinkSync(CACHE); } catch {}

  const newVer = readVer();
  const newHead = localHead() || '';
  say('\n');
  say(newVer === oldVer
    ? `ccshare: updated ${newVer} (${oldHead.slice(0, 7)} → ${newHead.slice(0, 7)})\n`
    : `ccshare: updated ${oldVer} → ${newVer}\n`);
  for (const s of whatsNew(oldVer)) {
    say(`\n  new in ${s.ver}:\n`);
    for (const h of s.heads) say(`    • ${h}\n`);
  }
  say(`\n  full notes: https://github.com/unworld11/ccshare/blob/master/CHANGELOG.md\n`);
  process.exit(0);
}

module.exports = { checkInBackground, cachedBehind, runUpdate };
