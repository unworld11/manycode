'use strict';
const { EventEmitter } = require('events');

const MAX_BUFFER = 256 * 1024;

// Wraps the claude process in a PTY. The host's own terminal attaches directly;
// remote participants are just extra dims + an output subscription.
class Session extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.cmd = opts.cmd || 'claude';
    this.args = opts.args || [];
    this.readOnly = !!opts.readOnly;
    this.dims = new Map(); // participantId -> {cols, rows}
    this.names = new Map();
    this.buffer = Buffer.alloc(0);
    this.exited = false;
    this.pty = null;
  }

  start() {
    const pty = require('node-pty');
    this.hostCols = process.stdout.columns || 80;
    this.hostRows = process.stdout.rows || 24;
    this._lastCols = this.hostCols;
    this._lastRows = this.hostRows;
    this.pty = pty.spawn(this.cmd, this.args, {
      name: 'xterm-256color',
      cols: this.hostCols,
      rows: this.hostRows,
      cwd: process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    this.pty.onData((d) => {
      process.stdout.write(d);
      const buf = Buffer.from(d, 'utf8');
      this._remember(buf);
      this.emit('output', buf);
    });
    this.pty.onExit(({ exitCode }) => {
      this.exited = true;
      this.emit('exit', exitCode);
    });

    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    this._stdinListener = (d) => { if (!this.exited) this.pty.write(d.toString('utf8')); };
    process.stdin.on('data', this._stdinListener);

    this._resizeListener = () => {
      this.hostCols = process.stdout.columns || 80;
      this.hostRows = process.stdout.rows || 24;
      this.applyResize();
    };
    process.stdout.on('resize', this._resizeListener);
  }

  _remember(buf) {
    this.buffer = Buffer.concat([this.buffer, buf]);
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer = this.buffer.subarray(this.buffer.length - MAX_BUFFER);
    }
  }

  // keystrokes from remote participants
  input(buf) {
    if (this.readOnly || this.exited || !this.pty) return;
    this.pty.write(buf.toString('utf8'));
  }

  addParticipant(id, name, cols, rows) {
    this.dims.set(id, { cols: cols || 80, rows: rows || 24 });
    this.names.set(id, name || String(id));
    this.applyResize();
    this.emit('roster', { joined: this.names.get(id) });
  }

  setDims(id, cols, rows) {
    if (!this.dims.has(id)) return;
    this.dims.set(id, { cols: cols || 80, rows: rows || 24 });
    this.applyResize();
  }

  removeParticipant(id) {
    if (!this.dims.has(id)) return;
    const name = this.names.get(id);
    this.dims.delete(id);
    this.names.delete(id);
    this.applyResize();
    this.emit('roster', { left: name });
  }

  // everyone sees the same screen, so the PTY runs at the smallest terminal
  applyResize() {
    if (this.exited || !this.pty) return;
    let cols = this.hostCols;
    let rows = this.hostRows;
    for (const d of this.dims.values()) {
      cols = Math.min(cols, d.cols);
      rows = Math.min(rows, d.rows);
    }
    cols = Math.max(cols, 20);
    rows = Math.max(rows, 5);
    if (cols !== this._lastCols || rows !== this._lastRows) {
      this._lastCols = cols;
      this._lastRows = rows;
      try { this.pty.resize(cols, rows); } catch {}
      this.emit('resize', cols, rows); // recorder writes these as cast events
    }
  }

  // resize jiggle: Ink repaints its whole viewport on SIGWINCH, which gives a
  // fresh frame to anyone who just connected
  repaint() {
    if (this.exited || !this.pty) return;
    const cols = this._lastCols;
    const rows = this._lastRows;
    if (rows < 6) return;
    try {
      this.pty.resize(cols, rows - 1);
      setTimeout(() => {
        if (!this.exited) { try { this.pty.resize(cols, rows); } catch {} }
      }, 80);
    } catch {}
  }

  replayData() {
    return this.buffer;
  }

  stop() {
    try { if (this.pty) this.pty.kill(); } catch {}
  }
}

module.exports = { Session };
