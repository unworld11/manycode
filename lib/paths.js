'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// manycode was born as ccshare - adopt the old dot-dir wholesale on first
// run so configs, session state, and the update cache survive the rename.
// If the rename fails (or an old install recreates ~/.ccshare mid-session),
// we keep using whichever dir actually exists.
const NEW = process.env.MANYCODE_STATE_DIR || path.join(os.homedir(), '.manycode');
const OLD = path.join(os.homedir(), '.ccshare');
try {
  if (!process.env.MANYCODE_STATE_DIR && !fs.existsSync(NEW) && fs.existsSync(OLD)) fs.renameSync(OLD, NEW);
} catch {}

module.exports = { DIR: process.env.MANYCODE_STATE_DIR || (fs.existsSync(NEW) || !fs.existsSync(OLD) ? NEW : OLD) };
