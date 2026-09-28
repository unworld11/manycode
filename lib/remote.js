'use strict';
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { DIR } = require('./paths');
const file = path.join(DIR, 'remote.json');

function checkStore() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const dir = fs.lstatSync(DIR);
  if (!dir.isDirectory() || dir.isSymbolicLink() || (process.getuid && dir.uid !== process.getuid())) throw new Error('Unsafe Manycode state directory');
  fs.chmodSync(DIR, 0o700);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid())) throw new Error('Unsafe remote connection file');
    if ((stat.mode & 0o077) !== 0) throw new Error('Remote connection file must have permissions 0600');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function parseInvite(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid Manycode invite URL'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Invite must use HTTPS (HTTP is allowed only on localhost)');
  if (url.username || url.password || url.search || url.pathname !== '/') throw new Error('Use the original Manycode invite URL');
  const token = url.hash.slice(1);
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('Invite is missing a valid access secret');
  return { origin: url.origin, token };
}

function load() {
  checkStore();
  let connection;
  try { connection = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('No saved connection. Run manycode remote connect INVITE_URL'); }
  return parseInvite(`${connection.origin}/#${connection.token}`);
}

async function request(connection, endpoint, body) {
  let response;
  try {
    response = await fetch(connection.origin + endpoint, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${connection.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch { throw new Error(body ? 'Could not reach host; delivery is unknown. Read the conversation before retrying.' : 'Could not reach host. Ask them to keep sharing running and verify the invite.'); }
  if (!response.ok) {
    if (body && ![400, 401, 403, 404, 409, 413, 429].includes(response.status)) throw new Error(`Host request failed (HTTP ${response.status}); delivery is unknown. Read the conversation before retrying.`);
    throw new Error(response.status === 401 ? 'Invite expired or revoked. Ask the host for a fresh invite.' : response.status === 403 ? 'This invite cannot send prompts.' : `Host request failed (HTTP ${response.status})`);
  }
  let value;
  try { value = await response.json(); } catch { throw new Error('Host returned an invalid response'); }
  return value;
}

function validateConversation(value) {
  if (!value || typeof value.title !== 'string' || typeof value.id !== 'string' || !Array.isArray(value.turns) || !['viewer', 'contributor'].includes(value.role)) throw new Error('Host did not return a shared conversation');
  return value;
}

async function run(args, out = console.log) {
  const [command, ...values] = args;
  if (command === 'connect' && values.length === 1) {
    const connection = parseInvite(values[0]);
    const conversation = validateConversation(await request(connection, '/conversation'));
    checkStore();
    const temporary = path.join(DIR, `.remote-${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, JSON.stringify(connection), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } finally { try { fs.unlinkSync(temporary); } catch {} }
    out(`Connected: ${conversation.title} (${conversation.role}). Only this shared conversation is accessible; it is not mirrored into your native chat history.`);
  } else if (command === 'read' && (values.length === 0 || (values.length === 1 && values[0] === '--json'))) {
    const conversation = validateConversation(await request(load(), '/conversation'));
    if (values[0] === '--json') out(JSON.stringify({ scope: 'selected shared conversation', ...conversation }));
    else {
      out(`${conversation.title} (${conversation.role}) — selected shared conversation only`);
      for (const turn of conversation.turns) for (const item of turn.items || []) {
        if (['user', 'assistant', 'tool'].includes(item.role) && typeof item.text === 'string') out(`\n${item.role}: ${item.text}`);
      }
    }
  } else if (command === 'prompt' && values.length) {
    const text = values.join(' ').trim();
    if (!text || text.length > 16000) throw new Error('Prompt must contain 1–16000 characters');
    const result = await request(load(), '/prompt', { text, requestId: randomUUID() });
    if (result.status !== 'queued') throw new Error('Host did not confirm queuing; read the conversation before retrying');
    out('Queued on the host. This does not mean completed. Run manycode remote read to check the response.');
  } else if (command === 'disconnect' && !values.length) {
    checkStore();
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    out('Saved invite removed from this computer. The host invite remains valid until the host revokes it.');
  } else throw new Error('Usage: manycode remote connect INVITE_URL | read [--json] | prompt TEXT | disconnect');
}

module.exports = { run, parseInvite };
