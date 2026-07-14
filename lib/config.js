'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = path.join(os.homedir(), '.ccshare', 'config.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}

function save(cfg) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2) + '\n');
  } catch {}
}

function exists() {
  return fs.existsSync(FILE);
}

module.exports = { load, save, exists, FILE };
