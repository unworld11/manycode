'use strict';
const token = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
const $ = id => document.getElementById(id);
const turns = new Map();
const pending = new Map();
let initialized = false;
let stopped = false;
let streamSocket;
let reconnectTimer;
let role;
let guestName;
function nearBottom() {
  const pane = $('messages');
  return pane.scrollHeight - pane.scrollTop - pane.clientHeight < 100;
}
function followBottom() { $('messages').scrollTop = $('messages').scrollHeight; }
function itemKey(item, index) { return item.id || `${item.role}:${index}`; }
function displayItem(item) {
  const participant = item.role === 'user' && /^\[Manycode participant: ([^\]\n]+)\]\n/.exec(item.text);
  return {
    label: participant ? participant[1] : item.role === 'user' ? 'Host' : item.role === 'assistant' ? 'Assistant' : 'Tool',
    text: participant ? item.text.slice(participant[0].length) : item.text,
  };
}
function setArticle(article, item) {
  const display = displayItem(item);
  article.dataset.role = item.role;
  if (article.firstChild.textContent !== display.label) article.firstChild.textContent = display.label;
  if (article._source !== display.text || article._sourceRole !== item.role) {
    article._source = display.text; article._sourceRole = item.role;
    const body = article.lastChild;
    body.className = item.role === 'tool' ? 'message-body' : 'message-body markdown-body';
    if (item.role === 'tool') body.textContent = display.text;
    else window.ManycodeMarkdown.render(body, display.text);
  }
}
function makeArticle(item) {
  const article = document.createElement('article');
  const author = document.createElement('b'); author.className = 'message-author';
  article.append(author, document.createElement('div'));
  setArticle(article, item);
  return article;
}
function updateTurn(turn) {
  let record = turns.get(turn.id);
  if (!record) {
    const element = document.createElement('section');
    element.dataset.turnId = turn.id;
    record = { element, items: new Map() };
    turns.set(turn.id, record);
    $('transcript').append(element);
  }
  record.turn = turn;
  const remaining = new Set();
  turn.items.forEach((item, index) => {
    const key = itemKey(item, index);
    remaining.add(key);
    let article = record.items.get(key);
    if (!article) {
      article = makeArticle(item);
      record.items.set(key, article);
    } else setArticle(article, item);
    const atIndex = record.element.children[index];
    if (atIndex !== article) record.element.insertBefore(article, atIndex || null);
  });
  for (const [key, article] of record.items) if (!remaining.has(key)) {
    article.remove(); record.items.delete(key);
  }
}
function reconcilePending() {
  for (const entry of pending.values()) {
    if (!entry.turnId && entry.accepted) {
      for (const { turn } of turns.values()) {
        const match = turn.items.find((item, index) => item.role === 'user' &&
          !entry.knownItems.has(`${turn.id}:${itemKey(item, index)}`) &&
          ((entry.clientUserMessageId && item.id === entry.clientUserMessageId) ||
            (item.text.startsWith(`[Manycode participant: ${guestName}]\n`) && item.text.slice(item.text.indexOf('\n') + 1) === entry.text.trim())));
        if (match && ![...pending.values()].some(other => other !== entry && other.turnId === turn.id)) {
          entry.turnId = turn.id; entry.article.remove(); break;
        }
      }
    }
    if (entry.turnId) {
      const turn = turns.get(entry.turnId)?.turn;
      if (!turn) continue;
      const status = turn.status === 'completed' ? 'Finished' : turn.status === 'inProgress' ? 'Running' : 'Received by host';
      entry.state = status;
    }
  }
  const latest = [...pending.values()].at(-1);
  if (latest) $('delivery').textContent = latest.state;
}
function applyState(state, replace) {
  const follow = !initialized || nearBottom();
  role = state.role;
  guestName = state.guestName;
  $('title').textContent = state.title;
  $('status').textContent = role === 'viewer' ? 'View only · Live' : 'Live';
  $('composer').hidden = role === 'viewer';
  $('send').disabled = role !== 'contributor';
  const removed = replace ? [...turns.keys()].filter(id => !state.turns.some(turn => turn.id === id)) : state.removedTurnIds || [];
  for (const id of removed) { turns.get(id)?.element.remove(); turns.delete(id); }
  for (const turn of state.turns) updateTurn(turn);
  if (replace) state.turns.forEach((turn, index) => {
    const element = turns.get(turn.id).element;
    if ($('transcript').children[index] !== element) $('transcript').insertBefore(element, $('transcript').children[index] || null);
  });
  reconcilePending();
  initialized = true;
  if (follow) followBottom();
}
function connect() {
  const url = new URL('/events', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  streamSocket = socket;
  socket.addEventListener('open', () => socket.send(JSON.stringify({ token })));
  socket.addEventListener('message', message => {
    try {
      const { event, data } = JSON.parse(message.data);
      if (event === 'snapshot' || event === 'update') applyState(data, event === 'snapshot');
      else if (event === 'available') $('status').textContent = role === 'viewer' ? 'View only · Live' : 'Live';
      else if (event === 'unavailable') $('status').textContent = data.error || 'Waiting for host';
    } catch { socket.close(1002, 'Invalid update'); }
  });
  socket.addEventListener('close', event => {
    if (stopped) return;
    if (event.code === 4401) {
      $('status').textContent = 'Invite is missing or revoked';
      $('send').disabled = true;
      role = undefined;
      return;
    }
    $('status').textContent = 'Reconnecting…';
    reconnectTimer = setTimeout(connect, 1000);
  });
}
$('composer').addEventListener('submit', async event => {
  event.preventDefault();
  const text = $('prompt').value;
  if (!text.trim() || role !== 'contributor') return;
  if (pending.size >= 200) {
    $('delivery').textContent = 'Session prompt limit reached. Ask the host to restart sharing.';
    return;
  }
  const requestId = crypto.randomUUID();
  const article = makeArticle({ role: 'user', text: `[Manycode participant: ${guestName}]\n${text}` });
  const entry = { text, article, state: 'Sending…', knownItems: new Set() };
  for (const { turn } of turns.values()) turn.items.forEach((item, index) => entry.knownItems.add(`${turn.id}:${itemKey(item, index)}`));
  pending.set(requestId, entry);
  $('pending').append(article);
  $('prompt').value = '';
  reconcilePending(); followBottom();
  try {
    const response = await fetch('/prompt', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ text, requestId }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Delivery not confirmed. Check the host chat before retrying.');
    entry.accepted = true;
    entry.clientUserMessageId = result.clientUserMessageId;
    entry.state = 'Queued. Waiting for the host app.';
  } catch (error) {
    entry.state = error.message;
    if (!$('prompt').value) $('prompt').value = text;
  }
  reconcilePending();
});
window.addEventListener('pagehide', () => { stopped = true; clearTimeout(reconnectTimer); streamSocket?.close(); });
$('send').disabled = true;
connect();
