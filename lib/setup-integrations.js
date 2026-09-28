'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const skillSource = path.join(__dirname, '..', 'skills', 'manycode-setup', 'SKILL.md');
const marker = '<!-- Managed by manycode setup -->';

function skillPaths() {
  return [process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')]
    .map(root => path.join(root, 'skills', 'manycode-setup', 'SKILL.md'));
}

function atomicWrite(file, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw new Error(`Refusing to replace symlink: ${file}`);
  }
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, content, { mode, flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function installSkills() {
  const content = fs.readFileSync(skillSource, 'utf8');
  const files = skillPaths();
  for (const file of files) {
    if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes(marker)) {
      throw new Error(`Existing skill is not managed by Manycode: ${file}`);
    }
  }
  for (const file of files) {
    atomicWrite(file, content);
    console.log(`Installed setup skill: ${file}`);
  }
}

function configureSSH(opts) {
  const alias = opts.sshAlias || 'manycode';
  const host = opts.sshHost;
  const user = opts.sshUser;
  const port = String(opts.sshPort || '22');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(alias)) throw new Error('Invalid SSH alias');
  if (!host || !/^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/.test(host)) throw new Error('--ssh-host must be a hostname or IP, without a username');
  if (!user || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(user)) throw new Error('--ssh-user is required');
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid SSH port');
  let identity = opts.sshIdentity;
  if (!identity) throw new Error('--ssh-identity must name an existing private key file');
  identity = path.resolve(identity.replace(/^~\//, `${os.homedir()}/`));
  if (/[\r\n"\\%$]/.test(identity) || !fs.statSync(identity).isFile()) throw new Error('Invalid SSH identity path');
  const file = path.join(os.homedir(), '.ssh', 'config');
  const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const begin = `# BEGIN MANYCODE ${alias}`;
  const end = `# END MANYCODE ${alias}`;
  const pattern = new RegExp(`^${begin}\\r?\\n[\\s\\S]*?^${end}\\r?\\n?`, 'm');
  const remainder = original.replace(pattern, '');
  if (remainder.includes(begin) || remainder.includes(end)) throw new Error('Malformed Manycode SSH block; repair it before setup');
  for (const line of remainder.split('\n')) {
    if (/^\s*Host\s+/i.test(line) && line.trim().split(/\s+/).slice(1).includes(alias)) {
      throw new Error(`SSH alias ${alias} already exists outside Manycode; choose --ssh-alias`);
    }
  }
  const block = `${begin}\nHost ${alias}\n    HostName ${host}\n    User ${user}\n    Port ${port}\n    IdentityFile "${identity}"\n    IdentitiesOnly yes\nHost *\n${end}\n`;
  // Reset the scope so pre-existing global options keep their meaning.
  const next = block + remainder;
  if (original !== next) {
    // Validate without connecting or executing Match exec in the user's config.
    const check = spawnSync('ssh', ['-G', '-F', '/dev/stdin', alias], { input: block, encoding: 'utf8' });
    if (check.status !== 0) throw new Error(`SSH rejected configuration: ${check.stderr || check.error?.message}`);
    if (original && !fs.existsSync(`${file}.before-manycode`)) {
      fs.writeFileSync(`${file}.before-manycode`, original, { mode: 0o600, flag: 'wx' });
    }
    atomicWrite(file, next);
  }
  console.log(`Configured SSH alias: ${alias}`);
  console.log(`Verify with: manycode doctor --ssh ${alias}`);
  console.log('Then open ChatGPT Settings > Connections > SSH, select the alias, and choose a project.');
  console.log('To share a selected chat, use manycode share-thread --thread ID --tunnel.');
  return alias;
}

function doctor(opts = {}) {
  const checks = skillPaths().map(file => ({
    check: file, ok: fs.existsSync(file) && fs.readFileSync(file, 'utf8') === fs.readFileSync(skillSource, 'utf8'),
  }));
  if (opts.ssh) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(opts.ssh)) throw new Error('Invalid SSH alias');
    const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ConnectTimeout=10', opts.ssh, 'codex --version'], { encoding: 'utf8', timeout: 15000 });
    checks.push({ check: `SSH ${opts.ssh}: remote Codex`, ok: result.status === 0,
      detail: (result.error?.message || result.stderr || result.stdout || '').trim() });
  }
  for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.check}${check.detail ? `\n${check.detail}` : ''}`);
  console.log('Desktop sharing: use manycode share-thread with a selected Codex/ChatGPT chat. Claude desktop attachment is not supported.');
  return checks.every(check => check.ok);
}

async function run(opts) {
  if (Object.keys(opts).some(k => k.startsWith('ssh')) && !opts.sshHost) throw new Error('--ssh-host is required with SSH options');
  if (opts.sshHost) configureSSH(opts);
  installSkills();
  if (!opts.skillsOnly && !opts.nonInteractive && !opts.sshHost) await require('./setup').run();
  console.log('Start a new Codex or Claude Code session and ask: Use manycode-setup to set up Manycode.');
}
module.exports = { run, doctor, configureSSH, installSkills };
