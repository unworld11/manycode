'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { verifyRelease } = require('./verify-release');
const { describeFile } = require('./release-manifest');
const root = path.resolve(__dirname, '..');
const repo = 'unworld11/manycode';
function publish() {
  const directory = path.join(root, 'app/.build/releases', require('../package.json').version + '-universal');
  const m = verifyRelease(directory);
  const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `v${m.version}`;
  const releases = JSON.parse(gh(['api', `repos/${repo}/releases?per_page=100`]));
  const existing = releases.find(r => r.tag_name === tag);
  if (existing) throw new Error(`Release ${tag} already exists. Versions are immutable; inspect any interrupted draft before retrying`);
  const compare = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  const latest = releases.filter(r => !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+$/.test(r.tag_name))
    .sort((a, b) => compare(b.tag_name.slice(1), a.tag_name.slice(1)))[0];
  if (latest && compare(m.version, latest.tag_name.slice(1)) <= 0) throw new Error(`Bump package.json above ${latest.tag_name} before publishing`);
  // Prove GitHub has the exact source before creating a tag or release.
  gh(['api', `repos/${repo}/commits/${m.commit}`, '--jq', '.sha']);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'manycode-publish-'));
  try {
    const alias = path.join(temporary, 'Manycode.dmg');
    fs.copyFileSync(path.join(directory, `Manycode-${m.version}-universal.dmg`), alias);
    const notes = path.join(temporary, 'notes.md');
    const installation = m.signing === 'notarized' ? 'Developer ID signed and notarized.' : 'Unsigned distribution (ad-hoc signature), not notarized by Apple. After dragging manycode into Applications and attempting to open it, you may need System Settings > Privacy & Security > Open Anyway. Only do this for a download you trust.';
    fs.writeFileSync(notes, `Manycode ${m.version} for macOS 13 and later, Apple Silicon and Intel.\n\n${installation} Download Manycode.dmg and drag manycode into Applications.\n\nSource: ${m.commit}\n\nSHA256SUMS and latest-mac.json describe the versioned DMG and ZIP.\n`);
    const artifacts = [...m.files.map(f => path.join(directory, f.name)), alias, path.join(directory, 'latest-mac.json'), path.join(directory, 'SHA256SUMS')];
    gh(['release', 'create', tag, '--repo', repo, '--target', m.commit, '--draft', '--title', `Manycode ${m.version}`, '--notes-file', notes, ...artifacts]);
    const downloaded = path.join(temporary, 'downloaded'); fs.mkdirSync(downloaded);
    gh(['release', 'download', tag, '--repo', repo, '--dir', downloaded]);
    for (const artifact of artifacts) {
      const expected = describeFile(artifact);
      const actual = describeFile(path.join(downloaded, expected.name));
      if (expected.sha256 !== actual.sha256 || expected.size !== actual.size) throw new Error(`Uploaded bytes differ for ${expected.name}; release remains a draft`);
    }
    gh(['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest']);
    const result = JSON.parse(gh(['release', 'view', tag, '--repo', repo, '--json', 'url,isDraft,tagName']));
    if (result.isDraft || result.tagName !== tag) throw new Error('Release publication was not confirmed');
    console.log(result.url);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
if (require.main === module) {
  try { publish(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { publish };
