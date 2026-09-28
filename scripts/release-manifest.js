'use strict';
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const repo = 'unworld11/manycode';
function describeFile(file) {
  const data = fs.readFileSync(file);
  return { name: path.basename(file), size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
}
function createManifest(directory, architecture, signing = 'adhoc') {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim()) throw new Error('Commit the release source before generating a release manifest');
  if (!['adhoc', 'notarized'].includes(signing)) throw new Error('Invalid signing mode');
  if (signing === 'notarized') for (const report of ['app-notary.json', 'dmg-notary.json']) {
    if (JSON.parse(fs.readFileSync(path.join(directory, report))).status !== 'Accepted') throw new Error(`Notarization was not accepted: ${report}`);
  }
  const files = ['dmg', 'zip'].map(ext => describeFile(path.join(directory, `Manycode-${version}-${architecture}.${ext}`)));
  const manifest = { schema: 1, version, commit, architecture, signing, minimumSystemVersion: '13.0', publishedAt: new Date().toISOString(), files: files.map(f => ({ ...f, url: `https://github.com/${repo}/releases/download/v${version}/${f.name}` })) };
  fs.writeFileSync(path.join(directory, 'latest-mac.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(directory, 'SHA256SUMS'), files.map(f => `${f.sha256}  ${f.name}`).join('\n') + '\n');
  return manifest;
}
if (require.main === module) {
  try { createManifest(path.resolve(process.argv[2]), process.argv[3], process.argv[4]); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { describeFile, createManifest };
