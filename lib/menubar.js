'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BIN_DIR = path.join(os.homedir(), '.ccshare', 'bin');
const BIN = path.join(BIN_DIR, 'ccshare-menubar');
const SRC = path.join(__dirname, '..', 'menubar', 'menubar.swift');

// Compile the Swift helper once (and again if the source changes).
function ensureBuilt(log) {
  if (process.platform !== 'darwin') return null;
  try {
    const srcM = fs.statSync(SRC).mtimeMs;
    const binM = fs.existsSync(BIN) ? fs.statSync(BIN).mtimeMs : 0;
    if (binM > srcM) return BIN;
    const swiftc = spawnSync('xcrun', ['-f', 'swiftc'], { stdio: 'ignore' });
    if (swiftc.status !== 0) return null;
    if (log) log('ccshare: building menu bar helper (first run, takes a few seconds)\n');
    fs.mkdirSync(BIN_DIR, { recursive: true });
    const r = spawnSync('swiftc', ['-O', '-o', BIN, SRC], { stdio: 'ignore', timeout: 120000 });
    return r.status === 0 && fs.existsSync(BIN) ? BIN : null;
  } catch {
    return null;
  }
}

// Launch detached. The helper is single-instance via its own pidfile, so
// calling this when one is already running is a no-op.
function launch(log, opts = {}) {
  const bin = ensureBuilt(log);
  if (!bin) return false;
  try {
    const args = opts.persistent ? [] : ['--auto'];
    spawn(bin, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
}

module.exports = { launch, ensureBuilt };
