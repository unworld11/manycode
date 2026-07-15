'use strict';
const os = require('os');
const { spawnSync } = require('child_process');
const config = require('./config');

// Interactive first-run onboarding. Dependency-free TUI: raw stdin, ANSI
// colors matching the site (orange/green on near-black terminals).
const C = {
  orange: '\x1b[38;2;217;119;87m',
  green: '\x1b[38;2;134;196;142m',
  amber: '\x1b[38;2;232;193;112m',
  dim: '\x1b[38;2;92;101;112m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
  hide: '\x1b[?25l',
  show: '\x1b[?25h',
};

const KNOWN_AGENTS = [
  { bin: 'claude', label: 'claude code' },
  { bin: 'codex', label: 'codex' },
  { bin: 'opencode', label: 'opencode' },
  { bin: 'kimi', label: 'kimi' },
  { bin: 'aider', label: 'aider' },
  { bin: 'gemini', label: 'gemini cli' },
];

function installedAgents() {
  return KNOWN_AGENTS.filter((a) => {
    const r = spawnSync('which', [a.bin], { stdio: 'ignore' });
    return r.status === 0;
  });
}

function write(s) { process.stdout.write(s); }

function readKeys(onKey) {
  const wasRaw = process.stdin.isRaw;
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  const handler = (buf) => {
    const s = buf.toString('utf8');
    onKey(s);
  };
  process.stdin.on('data', handler);
  return () => {
    process.stdin.removeListener('data', handler);
    if (process.stdin.isTTY && !wasRaw) process.stdin.setRawMode(false);
  };
}

function textInput(label, initial) {
  return new Promise((resolve, reject) => {
    let value = initial || '';
    const render = () => {
      write(`\r\x1b[2K  ${C.green}?${C.reset} ${label} ${C.dim}›${C.reset} ${C.bold}${value}${C.reset}`);
    };
    render();
    const stop = readKeys((k) => {
      if (k === '\x03') { stop(); reject(new Error('cancelled')); return; }
      if (k === '\r' || k === '\n') {
        stop();
        write(`\r\x1b[2K  ${C.green}✓${C.reset} ${label} ${C.dim}›${C.reset} ${C.orange}${value}${C.reset}\n`);
        resolve(value.trim());
        return;
      }
      if (k.startsWith('\x1b')) return; // arrows etc. mean nothing here
      // handle pasted text and batched keys: apply char by char
      for (const ch of k) {
        if (ch === '\x7f' || ch === '\b') value = value.slice(0, -1);
        else if (ch.charCodeAt(0) >= 32) value += ch;
      }
      render();
    });
  });
}

function select(label, options, initialIndex) {
  return new Promise((resolve, reject) => {
    let idx = initialIndex || 0;
    let drawn = false;
    const render = () => {
      if (drawn) write(`\x1b[${options.length + 1}A`);
      drawn = true;
      write(`\r\x1b[2K  ${C.green}?${C.reset} ${label}\n`);
      options.forEach((o, i) => {
        const on = i === idx;
        const ptr = on ? `${C.orange}❯${C.reset}` : ' ';
        const text = on ? `${C.bold}${o.label}${C.reset}` : `${C.dim}${o.label}${C.reset}`;
        const hint = o.hint ? `  ${C.dim}${o.hint}${C.reset}` : '';
        write(`\r\x1b[2K   ${ptr} ${text}${hint}\n`);
      });
    };
    write(C.hide);
    render();
    const stop = readKeys((k) => {
      if (k === '\x03') { stop(); write(C.show); reject(new Error('cancelled')); return; }
      if (k === '\x1b[A' || k === 'k') { idx = (idx - 1 + options.length) % options.length; render(); return; }
      if (k === '\x1b[B' || k === 'j') { idx = (idx + 1) % options.length; render(); return; }
      if (k === '\r' || k === '\n') {
        stop();
        write(`\x1b[${options.length + 1}A`);
        write(`\r\x1b[2K  ${C.green}✓${C.reset} ${label} ${C.dim}›${C.reset} ${C.orange}${options[idx].label}${C.reset}\n`);
        for (let i = 0; i < options.length; i++) write('\r\x1b[2K\n');
        write(`\x1b[${options.length}A`);
        write(C.show);
        resolve(options[idx]);
      }
    });
  });
}

async function run(opts = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    // non-interactive (piped/CI): write sane defaults quietly
    const cfg = { name: os.userInfo().username, agent: 'claude', tunnel: true, menubar: true, setupDone: true };
    config.save({ ...config.load(), ...cfg });
    return cfg;
  }

  const prev = config.load();
  write('\n');
  write(`  ${C.dim}───${C.reset} ${C.bold}ccshare${C.reset} ${C.dim}─── let's set you up (30 seconds, arrows + enter)${C.reset}\n\n`);

  try {
    const name = await textInput('what should friends see when you join their session?', prev.name || os.userInfo().username);

    const found = installedAgents();
    const agentOptions = found.map((a) => ({
      label: a.label,
      value: a.bin,
      hint: a.bin === 'claude' ? 'default' : '',
    }));
    agentOptions.push({ label: 'something else…', value: '__other__' });
    let agent = 'claude';
    if (agentOptions.length > 1) {
      const startIdx = Math.max(0, agentOptions.findIndex((o) => o.value === (prev.agent || 'claude')));
      const picked = await select('which agent should `ccshare host` start by default?', agentOptions, startIdx);
      agent = picked.value === '__other__'
        ? (await textInput('command to run', prev.agent || '')) || 'claude'
        : picked.value;
    } else if (found.length === 1) {
      agent = found[0].bin;
    }

    const tunnel = await select('sessions reachable from other networks by default?', [
      { label: 'yes, open a tunnel', hint: 'free cloudflare url, dies with the session' },
      { label: 'no, my wifi only', hint: 'turn on per-session with --tunnel' },
    ], prev.tunnel === false ? 1 : 0);

    let menubar = true;
    let approve = prev.approve === true;
    if (process.platform === 'darwin') {
      const mb = await select('show the live code in your menu bar while hosting?', [
        { label: 'yes', hint: 'copy join commands, see who’s connected' },
        { label: 'no', hint: 'use `ccshare code` instead' },
      ], prev.menubar === false ? 1 : 0);
      menubar = mb === undefined ? true : mb.label === 'yes';

      const ap = await select('ask before each joiner is let in?', [
        { label: 'no, the code is enough', hint: 'anyone with the code connects instantly' },
        { label: 'yes, pop a dialog', hint: 'every join waits for your ok (per-session: --approve)' },
      ], approve ? 1 : 0);
      approve = ap.label.startsWith('yes');
    }

    // ask once, only when gh is installed and logged in - never star silently
    let starAsked = prev.starAsked || false;
    if (!starAsked) {
      const ghAuthed = spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' }).status === 0;
      if (ghAuthed) {
        starAsked = true;
        const star = await select('enjoying this? star ccshare on github?', [
          { label: 'sure ⭐', hint: 'runs: gh api -X PUT user/starred/unworld11/ccshare' },
          { label: 'maybe later', hint: 'github.com/unworld11/ccshare' },
        ], 0);
        if (star.label.startsWith('sure')) {
          const r = spawnSync('gh', ['api', '-X', 'PUT', 'user/starred/unworld11/ccshare', '--silent'], { stdio: 'ignore' });
          write(r.status === 0
            ? `  ${C.amber}★${C.reset} ${C.dim}thanks!${C.reset}\n`
            : `  ${C.dim}couldn't star (gh api failed) - github.com/unworld11/ccshare${C.reset}\n`);
        }
      }
    }

    const cfg = {
      ...prev,
      name,
      agent,
      tunnel: tunnel.label.startsWith('yes'),
      menubar,
      approve,
      starAsked,
      setupDone: true,
    };
    config.save(cfg);

    const agentName = agent === 'claude' ? 'claude code' : agent;
    const W = 54;
    const row = (left, cmd) => {
      const plain = `   ${left}${cmd}`;
      const pad = ' '.repeat(Math.max(1, W - plain.length));
      return `  ${C.dim}│${C.reset}   ${left}${C.green}${cmd}${C.reset}${pad}${C.dim}│${C.reset}\n`;
    };
    const blank = `  ${C.dim}│${' '.repeat(W)}│${C.reset}\n`;
    write('\n');
    write(`  ${C.dim}╭── you're set ${'─'.repeat(W - 15)}╮${C.reset}\n`);
    write(blank);
    write(row(`host ${agentName}:`.padEnd(18), 'ccshare host'));
    write(row('join a friend:'.padEnd(18), 'ccshare join CODE'));
    write(row('change this:'.padEnd(18), 'ccshare setup'));
    write(blank);
    write(`  ${C.dim}╰${'─'.repeat(W)}╯${C.reset}\n\n`);
    if (!opts.keepStdin) {
      process.stdin.pause();
    }
    return cfg;
  } catch (e) {
    write(C.show + '\n');
    // skipped: remember that so we never nag again, keep defaults
    const cfg = { ...prev, name: prev.name || os.userInfo().username, agent: prev.agent || 'claude', tunnel: prev.tunnel !== false, menubar: prev.menubar !== false, setupDone: true };
    config.save(cfg);
    write(`  ${C.dim}skipped - defaults saved, rerun any time with ccshare setup${C.reset}\n\n`);
    if (!opts.keepStdin) process.stdin.pause();
    return cfg;
  }
}

module.exports = { run };
