'use strict';
const fs = require('fs');
const path = require('path');

// Values that are technically in .env files but redacting them would mangle
// half the terminal output (NODE_ENV=production would dot out the word
// "production" everywhere). Short values are skipped by the length check.
const STOPLIST = new Set([
  'true', 'false', 'null', 'undefined', 'localhost', 'development',
  'production', 'staging', 'test', 'debug', 'info', 'warn', 'error',
  'example', 'change-me', 'changeme', 'password', 'secret', 'default',
]);

// Parse KEY=VALUE lines from every .env* file in dir. Returns the values
// worth guarding - long enough to be real credentials, not stoplisted.
function collectSecrets(dir) {
  let files;
  try { files = fs.readdirSync(dir).filter((f) => f === '.env' || f.startsWith('.env.')); } catch { return { files: [], values: [] }; }
  const values = new Set();
  for (const f of files) {
    let body;
    try { body = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (let line of body.split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      if (line.startsWith('export ')) line = line.slice(7);
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      let v = line.slice(eq + 1).trim();
      const m = v.match(/^(["'])(.*)\1$/); // strip matching quotes
      if (m) v = m[2];
      if (v.length < 6 || STOPLIST.has(v.toLowerCase())) continue;
      values.add(v);
    }
  }
  return { files, values: [...values] };
}

// All matching happens on latin1 strings: byte-exact round-trips, so we can
// splice buffers without worrying about utf8 codepoints at chunk edges.
const MASK = Buffer.from('••••••', 'utf8').toString('latin1');

function needleize(values) {
  return values
    .map((v) => Buffer.from(v, 'utf8').toString('latin1'))
    .sort((a, b) => b.length - a.length); // longest first so subsets replace cleanly
}

function replaceAll(text, needles) {
  for (const n of needles) text = text.split(n).join(MASK);
  return text;
}

// longest suffix of text that is a proper prefix of needle - the bytes we
// must hold back because the rest of a secret may be in the next chunk
function suffixPrefixLen(text, needle) {
  const max = Math.min(text.length, needle.length - 1);
  for (let k = max; k > 0; k--) {
    if (text.endsWith(needle.slice(0, k))) return k;
  }
  return 0;
}

// Redact a complete buffer in one pass (replay data, no carry needed).
function redactBuffer(buf, values) {
  const needles = needleize(values);
  return Buffer.from(replaceAll(buf.toString('latin1'), needles), 'latin1');
}

// Streaming redactor for the live broadcast. Output that could be the start
// of a secret is held back until the next chunk decides it (or a short timer
// flushes it - terminal output is bursty, 25ms is invisible to a human).
function makeRedactor(values, emit, { holdMs = 25 } = {}) {
  const needles = needleize(values);
  let carry = '';
  let timer = null;

  const flush = () => {
    timer = null;
    if (!carry) return;
    const out = replaceAll(carry, needles); // a short secret can hide inside another's prefix
    carry = '';
    emit(Buffer.from(out, 'latin1'));
  };

  return {
    write(buf) {
      if (timer) { clearTimeout(timer); timer = null; }
      let text = replaceAll(carry + buf.toString('latin1'), needles);
      let hold = 0;
      for (const n of needles) hold = Math.max(hold, suffixPrefixLen(text, n));
      carry = hold ? text.slice(text.length - hold) : '';
      const out = text.slice(0, text.length - hold);
      if (out) emit(Buffer.from(out, 'latin1'));
      if (carry) { timer = setTimeout(flush, holdMs); timer.unref && timer.unref(); }
    },
    flush,
  };
}

module.exports = { collectSecrets, makeRedactor, redactBuffer };
