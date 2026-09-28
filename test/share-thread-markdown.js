'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startShare } = require('../lib/share-thread');
(async () => {
  const code = 'const greeting = "Mango";\nconsole.log(greeting);\n';
  const wide = 'A'.repeat(180);
  const formatted = [
    '# Shared project notes', '', 'A **bold decision**, *careful emphasis*, and `inline code`.', '',
    '## Next steps', '', '- Review the change', '  - Check the nested detail', '- [x] Build complete', '- [ ] Review pending', '',
    '> The same conversation, with readable answers.', '',
    '| Area | Owner | Status | Details |', '| --- | --- | --- | --- |', '| Client | Bob | Ready | Streaming |', '| Server | Alice | Review | Authenticated updates |', '',
    '[Documentation](https://example.com/docs)', '', '```javascript', code.trimEnd(), '```', '',
    '### Wide output', '', '```text', wide, '```', '',
    '<img src="https://manycode-invalid.example/raw-image" onerror="window.injected=1">', '',
    '<script>window.injected=1</script>', '', '[Unsafe](javascript:alert(1))', '',
    '![Remote photo](https://manycode-invalid.example/markdown-image)', '',
  ].join('\n');
  const thread = { id: 'markdown-test', name: 'Project review', turns: [
    { id: 'unchanged', status: 'completed', items: [{ id: 'u', type: 'userMessage', content: [{ type: 'text', text: '[Manycode participant: Bob]\nPlease review **these notes**.' }] }] },
    { id: 'formatted', status: 'completed', items: [{ id: 'a', type: 'agentMessage', text: formatted }] },
    { id: 'streaming', status: 'inProgress', items: [{ id: 's', type: 'agentMessage', text: '```python\nprint("streaming' }] },
  ] };
  const rpc = { async request(method) {
    if (method === 'thread/read') return { thread: structuredClone(thread) };
    if (method === 'thread/queue/list') return { data: [] };
    throw new Error('Unexpected RPC');
  } };
  const share = await startShare({ rpc, threadId: thread.id, guestName: 'Bob' });
  const browser = await chromium.launch({ headless: true });
  const artifacts = path.resolve(__dirname, '../../artifacts/markdown-review');
  fs.mkdirSync(artifacts, { recursive: true });
  const measurements = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    const errors = [], externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!request.url().startsWith(share.address)) externalRequests.push(request.url()); });
    await page.goto(`${share.address}/#${share.contributor}`);
    await page.waitForSelector('.markdown-body h1');
    const answer = page.locator('[data-turn-id=formatted]');
    assert.equal(await answer.locator('h1').textContent(), 'Shared project notes');
    assert.equal(await answer.locator('strong').textContent(), 'bold decision');
    assert.equal(await page.locator('[data-turn-id=unchanged] strong').textContent(), 'these notes');
    assert.equal(await answer.locator('ul ul li').count(), 1);
    assert.equal(await answer.locator('input[type=checkbox]').count(), 2);
    assert(await answer.locator('input[type=checkbox]').first().isChecked());
    assert(await answer.locator('input[type=checkbox]').first().isDisabled());
    assert.equal(await answer.locator('table tbody tr').count(), 2);
    assert.equal(await answer.locator('a[href="https://example.com/docs"]').count(), 1);
    assert(await answer.locator('a').evaluateAll(links => links.every(link => /^(https?:|mailto:)/.test(link.getAttribute('href')) && link.rel === 'noopener noreferrer')));
    assert(await answer.locator('.hljs-keyword').count() > 0);
    assert.equal(await answer.locator('img,script,iframe').count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.deepEqual(externalRequests, []);
    await answer.locator('.copy-code').first().click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code);
    assert.equal(await answer.locator('.copy-code').first().textContent(), 'Copied');
    await page.evaluate(() => { window.stableArticle = document.querySelector('[data-turn-id=unchanged] article'); window.stableBody = window.stableArticle.lastChild; });
    thread.turns[2].items[0].text = '```python\nprint("streaming finished")\n```\n\n**Complete.**';
    thread.turns[2].status = 'completed';
    await page.waitForFunction(() => document.querySelector('[data-turn-id=streaming] strong')?.textContent === 'Complete.');
    assert.equal(await page.locator('[data-turn-id=streaming] pre code').textContent(), 'print("streaming finished")\n');
    assert(await page.evaluate(() => window.stableArticle === document.querySelector('[data-turn-id=unchanged] article') && window.stableBody === window.stableArticle.lastChild));
    for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      await page.locator('#messages').evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({ path: path.join(artifacts, `${name}-notes.png`) });
      await answer.locator('.code-block').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(artifacts, `${name}-code.png`) });
      const bounds = await page.evaluate(() => ({
        viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
        table: [...document.querySelectorAll('.table-scroll')].map(el => ({ client: el.clientWidth, scroll: el.scrollWidth })),
        code: [...document.querySelectorAll('pre')].map(el => ({ client: el.clientWidth, scroll: el.scrollWidth })),
      }));
      assert(bounds.pageWidth <= bounds.viewport, `${name} page must not overflow horizontally`);
      assert(bounds.code.some(el => el.scroll > el.client), 'Wide code scrolls inside its block');
      if (name === 'mobile') assert(bounds.table.some(el => el.scroll > el.client), 'Mobile table scrolls inside its wrapper');
      measurements.push({ name, ...bounds });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({ passed: true, measurements, externalRequests, errors }, null, 2));
    console.log('PASS markdown: formatting, task lists, safe links, blocked HTML/images, syntax, clipboard, streamed fences, stable unchanged DOM, desktop/mobile bounds');
  } finally { await browser.close(); await share.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
