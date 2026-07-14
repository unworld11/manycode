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

function runUpdate() {
  process.stderr.write('ccshare: updating from git…\n');
  const pull = spawnSync('git', ['-C', ROOT, 'pull', '--ff-only'], { stdio: 'inherit' });
  if (pull.status !== 0) {
    process.stderr.write('ccshare: git pull failed - resolve it in ' + ROOT + ' and retry\n');
    process.exit(pull.status || 1);
  }
  const install = spawnSync('npm', ['i'], { cwd: ROOT, stdio: 'inherit' });
  if (install.status !== 0) process.exit(install.status || 1);
  try { fs.unlinkSync(CACHE); } catch {}
  process.stderr.write('ccshare: up to date. the menu bar helper rebuilds itself on your next host.\n');
  process.exit(0);
}

module.exports = { checkInBackground, cachedBehind, runUpdate };
