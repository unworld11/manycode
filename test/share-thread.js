'use strict';
const assert = require('assert/strict');
const { startShare } = require('../lib/share-thread');
(async () => {
  const calls = [];
  const threadId = 'chosen-test-thread';
  const rpc = { async request(method, params) {
    calls.push({ method, params });
    if (method === 'thread/read') return { thread: { id: threadId, name: 'Test', turns: [{ id: 't', items: [{ type: 'userMessage', id: 'u', content: [{ type: 'text', text: 'Only the chosen chat' }] }, { type: 'reasoning', text: 'PRIVATE' }] }] } };
    if (method === 'thread/queue/list') return {};
    if (method === 'thread/queue/add') return { queuedSubmission: { id: 'q' } };
    throw new Error('Unexpected method');
  } };
  const share = await startShare({ rpc, threadId, guestName: 'Bob' });
  try {
    const get = token => fetch(share.address + '/conversation', { headers: { authorization: `Bearer ${token}` } });
    const prompt = (token, data) => fetch(share.address + '/prompt', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal((await get('wrong')).status, 401);
    const viewer = await (await get(share.viewer)).json();
    assert.equal(viewer.role, 'viewer'); assert(!JSON.stringify(viewer).includes('PRIVATE'));
    const input = { requestId: 'same-request-123', text: 'Hello', threadId: 'unrelated-thread', method: 'command/exec', role: 'owner' };
    assert.equal((await prompt(share.viewer, input)).status, 403);
    const results = await Promise.all([prompt(share.contributor, input), prompt(share.contributor, input)]);
    assert(results.every(r => r.status === 202));
    assert.equal(calls.filter(c => c.method === 'thread/queue/add').length, 1);
    const queued = calls.find(c => c.method === 'thread/queue/add').params;
    assert.equal(queued.threadId, threadId); assert.match(queued.input[0].text, /participant: Bob/);
    assert.equal((await prompt(share.contributor, { ...input, text: 'changed' })).status, 409);
    assert.equal((await prompt(share.contributor, { ...input, requestId: 'large-request', text: 'x'.repeat(18000) })).status, 400);
    share.revoke(share.contributor);
    assert.equal((await get(share.contributor)).status, 401);
    console.log('PASS thread sharing: authorization, viewer restrictions, thread isolation, retry deduplication, revocation, private-item filtering');
  } finally { await share.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
