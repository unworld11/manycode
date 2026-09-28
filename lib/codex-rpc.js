'use strict';
const { spawn } = require('child_process');
const { createInterface } = require('readline');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');
const net = require('net');

class CodexRPC {
  constructor({ binary = 'codex', socket, args } = {}) {
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
    if (args) {
      this.child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.child.stderr.resume();
      this.child.on('error', error => this.fail(error));
      this.child.on('exit', () => this.fail(new Error('Codex connection closed')));
      this.child.stdin.on('error', error => this.fail(error));
      this.lines = createInterface({ input: this.child.stdout });
      this.lines.on('line', line => this.receive(line));
      this.ready = Promise.resolve();
    } else {
      const socketPath = socket || path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'app-server-control', 'app-server-control.sock');
      this.ws = new WebSocket('ws://localhost', { createConnection: () => net.connect(socketPath), handshakeTimeout: 10000, maxPayload: 16 * 1024 * 1024 });
      this.ready = new Promise((resolve, reject) => {
        this.ws.once('open', resolve);
        this.ws.once('error', reject);
      });
      this.ws.on('message', data => this.receive(data.toString()));
      this.ws.on('error', error => this.fail(error));
      this.ws.on('close', () => this.fail(new Error('Codex connection closed')));
    }
  }
  receive(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.method) {
      // Approval decisions stay with the owner. This bridge never approves tools.
      if (message.id !== undefined) this.write({ id: message.id, error: { code: -32601, message: 'Use the host app to handle this request' } });
      return;
    }
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  }
  write(message) {
    if (this.closed) return;
    if (this.ws) this.ws.send(JSON.stringify(message));
    else this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('Codex connection is closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}; delivery may be unknown`));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }
  async initialize() {
    await this.ready;
    await this.request('initialize', { clientInfo: { name: 'manycode', version: require('../package.json').version }, capabilities: { experimentalApi: true } });
    this.write({ method: 'initialized', params: {} });
    return this;
  }
  fail(error) {
    this.closed = true;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }
  close() { this.fail(new Error('Connection closed')); this.lines?.close(); this.child?.kill(); this.ws?.terminate(); }
}
module.exports = { CodexRPC };
