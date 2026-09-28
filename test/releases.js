'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { describeFile } = require('../scripts/release-manifest');
const { verifyManifest } = require('../scripts/verify-release');
const version = require('../package.json').version;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manycode-release-test-'));
try {
  const files = ['dmg', 'zip'].map(ext => {
    const name = `Manycode-${version}-universal.${ext}`;
    fs.writeFileSync(path.join(root, name), 'test artifact ' + ext);
    return { ...describeFile(path.join(root, name)), url: `https://github.com/unworld11/manycode/releases/download/v${version}/${name}` };
  });
  const manifest = { schema: 1, signing: 'adhoc', version, architecture: 'universal', commit: 'a'.repeat(40), files };
  const save = m => fs.writeFileSync(path.join(root, 'latest-mac.json'), JSON.stringify(m));
  save({ ...manifest, signing: 'unknown' }); assert.throws(() => verifyManifest(root), /signing/);
  save({ ...manifest, signing: 'notarized' }); assert.equal(verifyManifest(root).signing, 'notarized');
  save(manifest); assert.equal(verifyManifest(root).version, version);
  save({ ...manifest, architecture: 'arm64' }); assert.throws(() => verifyManifest(root), /universal/);
  save({ ...manifest, files: files.map(f => ({ ...f, url: 'https://example.invalid/' + f.name })) }); assert.throws(() => verifyManifest(root), /URL/);
  save({ ...manifest, files: [] }); assert.throws(() => verifyManifest(root), /DMG and ZIP/);
  save(manifest); fs.appendFileSync(path.join(root, files[0].name), 'tamper'); assert.throws(() => verifyManifest(root), /checksum/);
  const build = spawnSync('bash', ['app/build-dmg.sh', 'release'], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', env: { ...process.env, MANYCODE_SIGN_ID: '', MANYCODE_NOTARY_PROFILE: '' },
  });
  assert.notEqual(build.status, 0); assert.match(build.stderr, /Commit the release source|requires MANYCODE_SIGN_ID/);
  console.log('PASS release gates: manifest shape, expected destination, universal architecture, exact checksums, missing signing inputs fail closed');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
