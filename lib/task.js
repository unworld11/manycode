'use strict';
const fs = require('fs');
const path = require('path');
const { randomUUID, createHash } = require('crypto');
const { execFileSync } = require('child_process');
const DIR = path.join(require('./paths').DIR, 'tasks');

function taskFile(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('invalid task ID');
  return path.join(DIR, id + '.json');
}
function clean(value, max = 2000) {
  if (typeof value !== 'string') throw new Error('text is required');
  const text = value.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  if (!text || text.length > max) throw new Error(`text must contain 1-${max} characters`);
  return text;
}
function listTasks() {
  try { return fs.readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}

class SharedTask {
  constructor({ title, resume, cwd, hostName, persist = true }) {
    this.persist = persist;
    this.members = new Map([['host', { id: 'host', name: hostName, role: 'owner' }]]);
    this.driver = 'host';
    this.requests = new Set();
    this.data = resume ? JSON.parse(fs.readFileSync(taskFile(resume), 'utf8')) : {
      id: randomUUID(), title: clean(title, 200), cwd, goal: '', plan: '', preview: '',
      status: 'working', feedback: [], events: [], approvals: [], revision: null,
    };
    if (this.data.cwd !== cwd) throw new Error(`resume this task in ${this.data.cwd}`);
    this.data.prompts ||= [];
    for (const prompt of this.data.prompts) {
      if (['queued', 'sending'].includes(prompt.status)) { prompt.status = 'failed'; prompt.error = 'Session ended before delivery was confirmed; check the agent before submitting again'; }
    }
    if (persist) {
      fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
      this.lock = taskFile(this.data.id) + '.lock';
      try {
        const pid = Number(fs.readFileSync(this.lock, 'utf8'));
        let alive = true;
        try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
        if (alive) throw new Error('task is already hosted');
        fs.unlinkSync(this.lock);
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
      fs.writeFileSync(this.lock, String(process.pid), { flag: 'wx', mode: 0o600 });
      process.once('exit', () => { try { fs.unlinkSync(this.lock); } catch {} });
    }
    if (resume) { this.data.status = 'working'; this.data.approvals = []; this.data.revision = null; }
    this.event('host', resume ? 'resumed' : 'created', this.data.title);
  }
  save() {
    if (!this.persist) return;
    const file = taskFile(this.data.id);
    fs.writeFileSync(file + '.tmp', JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  }
  event(actor, kind, text) {
    this.data.events.push({ id: randomUUID(), at: new Date().toISOString(), actor, from: this.members.get(actor)?.name || actor, kind, text });
    this.save();
  }
  join(id, name) { this.members.set(id, { id, name: clean(name, 80), role: 'contributor' }); }
  leave(id) {
    if (this.driver === id) { this.driver = 'host'; this.event('host', 'control', 'Driver disconnected; control returned to host'); }
    this.members.delete(id); this.requests.delete(id);
  }
  snapshot() {
    return { ...this.data, events: this.data.events.slice(-100), members: [...this.members.values()], driver: this.driver, requests: [...this.requests] };
  }
  canDrive(id) { return this.driver === id && this.members.has(id) && this.data.status === 'working'; }
  async deliverPrompt(writeInput) {
    const prompt = this.data.prompts.find(p => p.status === 'queued');
    if (!prompt) return false;
    try {
      const member = this.members.get(prompt.actor);
      if (!member || member.role === 'viewer') throw new Error('Sender disconnected or no longer has prompt access');
      if (this.data.status !== 'working') throw new Error('Task is no longer working');
      prompt.status = 'sending';
      this.save();
      await writeInput(prompt.text, prompt.actor);
      prompt.status = 'sent';
    } catch (e) { prompt.status = 'failed'; prompt.error = e.message; }
    this.save();
    return true;
  }
  requireDriver(id) { if (this.driver !== id) throw new Error('Only the current driver can do that'); }
  requireOwner(id) { if (id !== 'host') throw new Error('Only the host can do that'); }
  changes() {
    const git = args => execFileSync('git', args, { cwd: this.data.cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
    const head = git(['rev-parse', 'HEAD']).trim();
    const diff = git(['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--']);
    const untracked = git(['ls-files', '--others', '--exclude-standard']);
    return { diff, untracked, revision: createHash('sha256').update(head + '\0' + diff + '\0' + untracked).digest('hex') };
  }
  action(id, msg) {
    const member = this.members.get(id);
    if (!member) throw new Error('Join the task first');
    if (member.role === 'viewer' && msg.action !== 'refresh') throw new Error('Viewers cannot change the task');
    const a = msg.action;
    if (a === 'refresh') return;
    if (a === 'request-control') {
      this.requests.add(id); this.event(id, 'request', 'Requested control');
    } else if (a === 'handoff') {
      if (id !== 'host') this.requireDriver(id);
      const next = this.members.get(msg.target);
      if (!next || next.role === 'viewer') throw new Error('Choose a connected contributor');
      this.driver = next.id; this.requests.delete(next.id);
      this.event(id, 'control', `Handed control to ${next.name}`);
    } else if (a === 'role') {
      this.requireOwner(id);
      const next = this.members.get(msg.target);
      if (!next || next.id === 'host' || !['viewer', 'contributor', 'reviewer'].includes(msg.role)) throw new Error('Invalid role or participant');
      if (next.id === this.driver && msg.role === 'viewer') this.driver = 'host';
      next.role = msg.role;
      this.event(id, 'role', `${next.name} is now ${msg.role}`);
    } else if (a === 'update') {
      this.requireDriver(id);
      const fields = {};
      for (const key of ['title', 'goal', 'plan', 'preview']) {
        if (msg[key] !== undefined) fields[key] = msg[key] === '' && key !== 'title' ? '' : clean(msg[key], key === 'title' ? 200 : 2000);
      }
      if (fields.preview) {
        const url = new URL(fields.preview);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Preview must be an http(s) URL without credentials');
      }
      Object.assign(this.data, fields);
      this.invalidate();
      this.event(id, 'updated', 'Updated the task brief');
    } else if (a === 'feedback') {
      if (this.data.feedback.length >= 500) throw new Error('Task feedback limit reached');
      const text = clean(msg.text);
      const anchor = msg.anchor ? clean(msg.anchor, 300) : 'task';
      this.data.feedback.push({ id: randomUUID(), author: id, from: member.name, text, anchor, status: 'open' });
      this.invalidate(); this.event(id, 'feedback', `${anchor}: ${text}`);
    } else if (a === 'resolve-feedback') {
      this.requireDriver(id);
      const item = this.data.feedback.find(f => f.id === msg.feedbackId);
      if (!item || item.status !== 'open' || !['accepted', 'rejected'].includes(msg.resolution)) throw new Error('Choose open feedback and a resolution');
      item.status = msg.resolution;
      this.invalidate(); this.event(id, 'decision', `${item.status}: ${item.text}`);
    } else if (a === 'instruct') {
      if (this.data.status !== 'working') throw new Error('Return the task to working before giving instructions');
      const text = clean(msg.text);
      const requestId = msg.requestId ? clean(msg.requestId, 100) : randomUUID();
      const prior = this.data.prompts.find(p => p.actor === id && p.requestId === requestId);
      if (prior) {
        if (prior.text !== text) throw new Error('Prompt request ID already used for different text');
        return prior;
      }
      if (this.data.prompts.filter(p => p.status === 'queued').length >= 32) throw new Error('Prompt queue is full; wait before sending more');
      const prompt = { id: randomUUID(), requestId, actor: id, from: member.name, text, at: new Date().toISOString(), status: 'queued' };
      this.data.prompts.push(prompt);
      if (this.data.prompts.length > 200) this.data.prompts.splice(0, this.data.prompts.length - 200);
      this.event(id, 'instruction', text);
      return prompt;
    } else if (a === 'working') {
      this.requireDriver(id); this.invalidate(); this.event(id, 'status', 'Returned to working');
    } else if (a === 'request-review') {
      this.requireDriver(id);
      if (this.data.prompts.some(p => ['queued', 'sending'].includes(p.status))) throw new Error('Wait for queued prompts before requesting review');
      if (this.data.feedback.some(f => f.status === 'open')) throw new Error('Resolve open feedback before requesting review');
      const changes = this.changes();
      if (changes.untracked) throw new Error('Stage or ignore untracked files before requesting review');
      this.data.revision = changes.revision; this.data.approvals = []; this.data.status = 'review';
      this.event(id, 'review', `Requested review of ${changes.revision.slice(0, 12)}`);
    } else if (a === 'approve' || a === 'complete') {
      if (a === 'approve' && !['owner', 'reviewer'].includes(member.role)) throw new Error('Only designated reviewers can approve');
      if (a === 'complete') this.requireDriver(id);
      if (this.data.status !== 'review') throw new Error('Request review first');
      if (msg.revision !== this.data.revision) throw new Error('Refresh and review the current diff first');
      const changes = this.changes();
      if (changes.revision !== this.data.revision || changes.untracked) {
        this.invalidate(); this.event(id, 'review-stale', 'Changes changed; review is required again');
        throw new Error('Changes changed; request a fresh review');
      }
      if (a === 'approve') {
        if (!this.data.approvals.some(x => x.actor === id)) this.data.approvals.push({ actor: id, from: member.name, revision: changes.revision });
        this.event(id, 'approved', `Approved ${changes.revision.slice(0, 12)}`);
      } else {
        if (!this.data.approvals.length) throw new Error('A reviewer must approve before completion');
        this.data.status = 'complete'; this.event(id, 'completed', 'Marked complete after review');
      }
    } else throw new Error('Unknown task action');
  }
  invalidate() { this.data.status = 'working'; this.data.approvals = []; this.data.revision = null; }
}
module.exports = { SharedTask, listTasks, clean };
