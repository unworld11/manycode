'use strict';
const token = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
const $ = id => document.getElementById(id);
let lastSnapshot = '';
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Connection failed');
  return result;
}
async function refresh() {
  try {
    const state = await request('/conversation');
    $('title').textContent = state.title;
    $('status').textContent = state.role === 'viewer' ? 'View only' : 'Connected';
    $('composer').hidden = state.role === 'viewer';
    const serialized = JSON.stringify(state.turns);
    if (serialized !== lastSnapshot) {
      lastSnapshot = serialized;
      $('messages').replaceChildren();
      for (const turn of state.turns) for (const item of turn.items) {
        const article = document.createElement('article'); article.dataset.role = item.role;
        const label = document.createElement('b'); label.textContent = item.role;
        article.append(label, document.createTextNode(item.text)); $('messages').append(article);
      }
    }
  } catch (error) { $('status').textContent = error.message; }
}
$('composer').addEventListener('submit', async event => {
  event.preventDefault();
  const text = $('prompt').value;
  if (!text.trim()) return;
  $('send').disabled = true;
  try {
    await request('/prompt', { method: 'POST', body: JSON.stringify({ text, requestId: crypto.randomUUID() }) });
    if ($('prompt').value === text) $('prompt').value = '';
    $('delivery').textContent = 'Queued. The host app will process it when ready; this may take a few seconds.';
  } catch (error) { $('delivery').textContent = error.message; }
  finally { $('send').disabled = false; }
});
refresh(); setInterval(refresh, 1500);
