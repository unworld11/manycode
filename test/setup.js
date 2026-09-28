'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manycode-setup-'));
const originalHome = os.homedir;
os.homedir = () => root;
process.env.CODEX_HOME = path.join(root, 'codex');
process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
const setup = require('../lib/setup-integrations');
try {
  fs.mkdirSync(path.join(root, '.ssh'));
  const config = path.join(root, '.ssh', 'config');
  const original = 'ServerAliveInterval 30\nHost existing\n  HostName example.org\n  User unchanged\n';
  fs.writeFileSync(config, original);
  const key = path.join(root, 'test key');
  fs.writeFileSync(key, 'synthetic fixture');
  const opts = { sshHost: 'example.com', sshUser: 'tester', sshIdentity: key, sshPort: '2222' };
  setup.configureSSH(opts);
  const first = fs.readFileSync(config, 'utf8');
  setup.configureSSH(opts);
  assert.equal(fs.readFileSync(config, 'utf8'), first, 'setup must be idempotent');
  assert.equal(fs.readFileSync(config + '.before-manycode', 'utf8'), original);
  const resolved = spawnSync('ssh', ['-G', '-F', config, 'manycode'], { encoding: 'utf8' });
  assert.equal(resolved.status, 0);
  assert.match(resolved.stdout, /^hostname example.com$/m);
  assert.match(resolved.stdout, /^port 2222$/m);
  assert.match(resolved.stdout, /^user tester$/m);
  assert.match(resolved.stdout, /^serveraliveinterval 30$/m);
  const existing = spawnSync('ssh', ['-G', '-F', config, 'existing'], { encoding: 'utf8' });
  assert.match(existing.stdout, /^hostname example.org$/m);
  assert.match(existing.stdout, /^user unchanged$/m);
  setup.configureSSH({ ...opts, sshHost: 'updated.example.com' });
  assert.equal((fs.readFileSync(config, 'utf8').match(/BEGIN MANYCODE/g) || []).length, 1);
  const updated = fs.readFileSync(config, 'utf8');
  for (const bad of [{ sshHost: 'host\nProxyCommand evil' }, { sshUser: '-oops' }, { sshPort: '0' }, { sshAlias: 'existing' }]) {
    assert.throws(() => setup.configureSSH({ ...opts, ...bad }));
    assert.equal(fs.readFileSync(config, 'utf8'), updated);
  }
  setup.installSkills();
  setup.installSkills();
  assert.equal(setup.doctor(), true);
  fs.writeFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'skills/manycode-setup/SKILL.md'), 'user owned skill');
  assert.throws(() => setup.installSkills(), /not managed/);
  assert.equal(setup.doctor(), false);
  const cli = spawnSync(process.execPath, [path.join(__dirname, '../bin/manycode.js'), 'setup', '--ssh-port', '22'], { encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /--ssh-host is required/);
  console.log('Setup: SSH preservation, repeat updates, validation, skills and diagnostics passed');
} finally {
  os.homedir = originalHome;
  fs.rmSync(root, { recursive: true, force: true });
}
