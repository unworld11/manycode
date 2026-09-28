'use strict';
// Runs only against a fresh local fixture in disposable browser contexts.
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const BIN = path.resolve(__dirname, '../bin/manycode.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manycode-browser-'));
const cwd = path.join(root, 'project'); const stateDir = path.join(root, 'state');
fs.mkdirSync(cwd); fs.mkdirSync(stateDir);
const env = { ...process.env, MANYCODE_STATE_DIR: stateDir };
fs.writeFileSync(path.join(stateDir, 'config.json'), JSON.stringify({ name: 'Owner', menubar: false, tunnel: false }));
const git = (...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
git('init'); fs.writeFileSync(path.join(cwd, 'checkout.js'), 'const status = "ready";\n'); git('add', '.');
git('-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-m', 'fixture');
let browser, host;
const errors = [];
(async () => {
  host = spawn(process.execPath, [BIN, 'host', '--task', 'Build checkout together', '--no-tunnel', '--no-menubar', '--no-chat-notify', '--port', '0', 'cat'], { cwd, env, stdio: 'pipe' });
  host.stdout.resume(); host.stderr.resume();
  let session;
  for (let i = 0; i < 100 && !session; i++) {
    try { session = JSON.parse(fs.readFileSync(path.join(stateDir, 'sessions', host.pid + '.json'), 'utf8')); } catch {}
    if (!session) await new Promise(r => setTimeout(r, 50));
  }
  assert(session, 'host started');
  const defaultChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (fs.existsSync(defaultChrome) ? defaultChrome : undefined) });
  const origin = `http://127.0.0.1:${session.port}`;
  async function client(name, token) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    // No external pages, profiles, credentials, or CDN requests are used.
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${origin}/#${session.code}${token ? ':' + token : ''}`);
    await page.locator('#name').fill(name); await page.locator('#go').click();
    await page.locator('#task-title').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#task-title').textContent(), 'Build checkout together');
    return page;
  }
  const owner = await client('Owner', session.ownerToken);
  const alice = await client('Alice');
  assert(await alice.locator('#task-instruct').isEnabled());
  await alice.locator('#instruction-text').fill('ALICE_PROMPT_WITHOUT_HANDOFF');
  await alice.locator('#task-instruct').click();
  await owner.locator('#term').getByText('ALICE_PROMPT_WITHOUT_HANDOFF', { exact: false }).first().waitFor();
  await owner.locator('#task-prompts').getByText('ALICE_PROMPT_WITHOUT_HANDOFF', { exact: true }).waitFor();
  assert.equal(await alice.locator('#instruction-text').inputValue(), '');
  await owner.locator('#instruction-text').fill('OWNER_SHARED_REPLY');
  await owner.locator('#task-instruct').click();
  await alice.locator('#term').getByText('OWNER_SHARED_REPLY', { exact: false }).first().waitFor();
  await owner.getByLabel('Role for Alice').selectOption('viewer');
  await alice.waitForFunction(() => document.getElementById('task-instruct').disabled);
  await owner.getByLabel('Role for Alice').selectOption('contributor');
  await alice.waitForFunction(() => !document.getElementById('task-instruct').disabled);
  await alice.locator('#feedback-anchor').fill('checkout.js:1');
  await alice.locator('#feedback-text').fill('Show a retry action when payment fails.');
  await alice.locator('#task-feedback-send').click();
  await owner.getByText('Show a retry action when payment fails.', { exact: true }).first().waitFor();
  await owner.getByRole('button', { name: 'Accept suggestion', exact: true }).click();
  await alice.locator('#task-request').click();
  const aliceRow = owner.locator('#task-people .task-item').filter({ hasText: 'Alice' });
  await aliceRow.getByRole('button', { name: 'Hand off' }).click();
  await alice.locator('#task-driver').filter({ hasText: 'Alice is driving' }).waitFor();
  await alice.locator('#instruction-text').fill('UI_INSTRUCTION_REACHED_TERMINAL');
  await alice.locator('#task-instruct').click();
  await owner.locator('#term').getByText('UI_INSTRUCTION_REACHED_TERMINAL', { exact: false }).first().waitFor();
  await owner.getByLabel('Role for Alice').selectOption('reviewer');
  fs.writeFileSync(path.join(cwd, 'checkout.js'), 'const status = "retry available";\n');
  await alice.getByText('Changes & review', { exact: true }).click();
  await alice.locator('#task-review').click();
  await alice.locator('#task-refresh-diff').click();
  await alice.locator('#task-diff').filter({ hasText: '+const status = "retry available";' }).waitFor();
  await alice.locator('#task-approve').click();
  await alice.locator('#task-approval-state').filter({ hasText: 'Approved by Alice' }).waitFor();
  await alice.locator('#task-complete').click();
  await owner.locator('#task-status').filter({ hasText: 'complete' }).waitFor();
  const late = await client('Late reviewer');
  await late.locator('#task-status').filter({ hasText: 'complete' }).waitFor();
  await late.getByText('Activity & decisions', { exact: true }).click();
  await late.locator('#task-activity').getByText('UI_INSTRUCTION_REACHED_TERMINAL', { exact: true }).waitFor();
  await owner.locator('#task-panel').evaluate(el => { el.scrollTop = 0; });
  await owner.screenshot({ path: path.join(root, 'desktop.png') });
  await alice.setViewportSize({ width: 390, height: 844 });
  await alice.locator('#task-panel').evaluate(el => { el.scrollTop = 0; });
  await alice.screenshot({ path: path.join(root, 'mobile.png') });
  assert.equal(await alice.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true, 'mobile has no horizontal overflow');
  assert.deepEqual(errors, []);
  console.log('PASS browser: two participants prompt without handoff, shared output and attribution, viewer restrictions, feedback, review, completion, late-join history, mobile layout');
  console.log(`Screenshots: ${root}/desktop.png and ${root}/mobile.png`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (host) host.kill('SIGTERM');
});
