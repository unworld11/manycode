/* Shared task controls use the same socket as the terminal. */
function createTaskPanel(send, setCanType) {
  const $ = id => document.getElementById(id);
  let task, me, loadedId, viewedRevision, previousVisit, pendingPrompt;
  const panel = $('task-panel');
  function action(action, fields = {}) {
    $('task-error').textContent = '';
    send({ t: 'task-action', action, ...fields });
  }
  function el(tag, text, parent, className) {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    if (className) n.className = className;
    if (parent) parent.appendChild(n);
    return n;
  }
  function button(text, parent, fn, disabled = false) {
    const b = el('button', text, parent); b.type = 'button'; b.disabled = disabled; b.onclick = fn; return b;
  }
  function render() {
    if (!task || !me) return;
    const driver = task.members.find(m => m.id === task.driver);
    const mine = task.members.find(m => m.id === me);
    const driving = me === task.driver;
    setCanType(driving && task.status === 'working');
    $('task-title').textContent = task.title;
    $('task-status').textContent = task.status;
    $('task-driver').textContent = `${driver?.name || 'Host'} is driving · ${task.members.length} people`;
    $('task-goal').textContent = task.goal || 'Add a goal so everyone knows what done means.';
    $('task-plan').textContent = task.plan || 'No plan recorded yet.';
    $('task-request').disabled = driving || mine?.role === 'viewer' || task.requests.includes(me);
    $('task-request').textContent = task.requests.includes(me) ? 'Control requested' : 'Request control';
    $('task-instruct').disabled = !mine || mine.role === 'viewer' || (task.promptReadOnly && me !== 'host') || task.status !== 'working' || !!pendingPrompt;
    const prompts = $('task-prompts'); prompts.replaceChildren();
    (task.prompts || []).slice(-30).forEach(p => {
      const row = el('div', '', prompts, 'task-item');
      el('small', `${p.from} · ${p.status === 'sent' ? 'Sent to agent' : p.status}`, row);
      el('p', p.text, row);
      if (p.error) el('small', p.error, row);
    });
    $('task-save').disabled = !driving;
    $('task-feedback-send').disabled = mine?.role === 'viewer';
    $('task-review').disabled = !driving || task.status !== 'working' || (task.prompts || []).some(p => p.status === 'queued' || p.status === 'sending');
    $('task-working').disabled = !driving || task.status === 'working';
    $('task-approve').disabled = !['owner', 'reviewer'].includes(mine?.role) || task.status !== 'review' || viewedRevision !== task.revision;
    $('task-complete').disabled = !driving || !task.approvals.length || task.status !== 'review' || viewedRevision !== task.revision;
    $('task-approval-state').textContent = task.approvals.length ? 'Approved by ' + task.approvals.map(a => a.from).join(', ') : 'No approvals yet. Refresh the diff before approving.';
    const preview = $('task-preview');
    preview.hidden = !task.preview;
    if (/^https?:\/\//.test(task.preview)) preview.href = task.preview; else preview.removeAttribute('href');
    const people = $('task-people'); people.replaceChildren();
    task.members.forEach(m => {
      const row = el('div', '', people, 'task-item');
      el('span', `${m.name}${m.id === me ? ' (you)' : ''} · ${m.role}${task.requests.includes(m.id) ? ' · wants control' : ''}`, row);
      if ((driving || me === 'host') && m.id !== task.driver && m.role !== 'viewer') button('Hand off', row, () => action('handoff', { target: m.id }));
      if (me === 'host' && m.id !== 'host') {
        const role = el('select', '', row); role.setAttribute('aria-label', `Role for ${m.name}`);
        ['viewer', 'contributor', 'reviewer'].forEach(r => { const o = el('option', r, role); o.value = r; });
        role.value = m.role; role.onchange = () => action('role', { target: m.id, role: role.value });
      }
    });
    const feedback = $('task-feedback'); feedback.replaceChildren();
    if (!task.feedback.length) el('p', 'Feedback on files, previews, and decisions appears here.', feedback, 'muted');
    task.feedback.slice().reverse().forEach(f => {
      const row = el('div', '', feedback, 'task-item');
      el('small', `${f.from} · ${f.anchor} · ${f.status}`, row); el('p', f.text, row);
      if (driving && f.status === 'open') {
        button('Accept suggestion', row, () => action('resolve-feedback', { feedbackId: f.id, resolution: 'accepted' }));
        button('Decline', row, () => action('resolve-feedback', { feedbackId: f.id, resolution: 'rejected' }));
      }
    });
    const activity = $('task-activity'); activity.replaceChildren();
    task.events.slice().reverse().forEach(e => {
      const row = el('div', '', activity, 'task-item');
      el('small', `${e.from} · ${e.kind} · ${new Date(e.at).toLocaleTimeString()}`, row);
      el('p', e.text, row);
    });
    const recent = task.events.filter(e => !previousVisit || e.at > previousVisit);
    $('task-catchup').textContent = `${recent.length} recorded updates${previousVisit ? ' since your last visit' : ''}. ${task.feedback.filter(f => f.status === 'open').length} suggestions need a decision. ${task.status === 'review' ? 'The task is waiting for review.' : ''}`;
    $('task-catchup-events').replaceChildren();
    recent.slice(-5).forEach(e => el('li', `${e.from}: ${e.text}`, $('task-catchup-events')));
    try { localStorage.setItem('manycode-visit-' + task.id, task.events.at(-1)?.at || ''); } catch {}
  }
  $('task-request').onclick = () => action('request-control');
  $('task-edit').ontoggle = () => {
    if (!$('task-edit').open || !task) return;
    for (const key of ['title', 'goal', 'plan', 'preview']) $('edit-' + key).value = task[key];
  };
  $('task-brief').onsubmit = e => {
    e.preventDefault();
    action('update', Object.fromEntries(['title', 'goal', 'plan', 'preview'].map(k => [k, $('edit-' + k).value])));
  };
  $('task-feedback-form').onsubmit = e => {
    e.preventDefault();
    action('feedback', { text: $('feedback-text').value, anchor: $('feedback-anchor').value || 'task' });
  };
  $('task-instruction-form').onsubmit = e => {
    e.preventDefault();
    if (pendingPrompt) return;
    pendingPrompt = { requestId: Date.now().toString(36) + Math.random().toString(36).slice(2), text: $('instruction-text').value };
    action('instruct', pendingPrompt); render();
  };
  $('task-review').onclick = () => action('request-review');
  $('task-working').onclick = () => action('working');
  $('task-approve').onclick = () => action('approve', { revision: viewedRevision });
  $('task-complete').onclick = () => action('complete', { revision: viewedRevision });
  $('task-refresh-diff').onclick = () => { $('task-diff').textContent = 'Loading changes…'; send({ t: 'task-changes' }); };
  return {
    disconnect() { setCanType(false); panel.querySelectorAll('button').forEach(b => { b.disabled = true; }); $('task-error').textContent = 'Disconnected. Rejoin to continue.'; },
    receive(m) {
      if (m.t === 'task-identity') { me = m.id; render(); }
      if (m.t === 'task') {
        task = m.task;
        if (loadedId !== task.id) {
          loadedId = task.id; viewedRevision = undefined;
          try { previousVisit = localStorage.getItem('manycode-visit-' + task.id); } catch {}
          $('taskbtn').hidden = false; $('taskbtn').click();
        }
        render();
      }
      if (m.t === 'task-error') {
        $('task-error').textContent = m.msg;
        if (pendingPrompt && pendingPrompt.requestId === m.requestId) { pendingPrompt = null; render(); }
      }
      if (m.t === 'task-result') {
        $('task-error').textContent = m.promptId ? 'Prompt queued. Everyone can see it.' : 'Saved.';
        if (pendingPrompt && pendingPrompt.requestId === m.requestId) {
          if ($('instruction-text').value === pendingPrompt.text) $('instruction-text').value = '';
          pendingPrompt = null; render();
        }
      }
      if (m.t === 'task-changes') {
        viewedRevision = m.revision;
        $('task-diff').textContent = (m.diff || 'No tracked changes.') + (m.untracked ? '\nUntracked files (stage or ignore before review):\n' + m.untracked : '');
        $('task-revision').textContent = 'Revision ' + m.revision.slice(0, 12);
        render();
      }
    },
  };
}
