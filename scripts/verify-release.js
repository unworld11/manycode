'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { describeFile } = require('./release-manifest');
const root = path.resolve(__dirname, '..');
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function verifyManifest(directory) {
  const m = JSON.parse(fs.readFileSync(path.join(directory, 'latest-mac.json'), 'utf8'));
  if (m.schema !== 1 || !/^\d+\.\d+\.\d+$/.test(m.version) || !/^[a-f0-9]{40}$/.test(m.commit) || m.architecture !== 'universal') throw new Error('Public releases require a valid universal release manifest');
  if (!['adhoc', 'notarized'].includes(m.signing)) throw new Error('Invalid signing mode');
  if (m.version !== require('../package.json').version) throw new Error('Manifest version differs from package.json');
  if (!Array.isArray(m.files) || m.files.length !== 2) throw new Error('Expected DMG and ZIP');
  for (const ext of ['dmg', 'zip']) {
    const name = `Manycode-${m.version}-universal.${ext}`;
    const file = m.files.find(f => f.name === name);
    if (!file || file.url !== `https://github.com/unworld11/manycode/releases/download/v${m.version}/${name}`) throw new Error('Invalid artifact URL or name');
    const actual = describeFile(path.join(directory, name));
    if (actual.size !== file.size || actual.sha256 !== file.sha256) throw new Error(`Artifact checksum mismatch: ${name}`);
  }
  return m;
}
function verifyRelease(directory) {
  if (process.platform !== 'darwin') throw new Error('Release verification requires macOS');
  const m = verifyManifest(directory);
  if (run('git', ['-C', root, 'rev-parse', 'HEAD']).trim() !== m.commit || run('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all']).trim()) throw new Error('Release source must be committed and match the manifest');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'manycode-release-'));
  const mount = path.join(temporary, 'mounted');
  let mounted = false;
  function appCheck(app) {
    run('codesign', ['--verify', '--deep', '--strict', app]);
    const signature = spawnSync('codesign', ['--display', '--verbose=4', app], { encoding: 'utf8' });
    if (signature.status !== 0) throw new Error('Cannot inspect app signature');
    if (m.signing === 'adhoc' && !/^Signature=adhoc$/m.test(signature.stderr)) throw new Error('Expected an ad-hoc signature');
    if (m.signing === 'notarized' && (!/^Authority=Developer ID Application: /m.test(signature.stderr) || !/flags=.*runtime/.test(signature.stderr))) throw new Error('App lacks a Developer ID hardened-runtime signature');
    const identifier = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(app, 'Contents/Info.plist')]).trim();
    if (identifier !== 'app.manycode.desktop') throw new Error('Unexpected app identity');
    if (m.signing === 'notarized') {
      run('xcrun', ['stapler', 'validate', app]);
      run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
    }
    const version = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(app, 'Contents/Info.plist')]).trim();
    if (version !== m.version) throw new Error('Packaged app version does not match manifest');
    const binary = path.join(app, 'Contents/MacOS/Manycode');
    for (const architecture of ['arm64', 'x86_64']) run('lipo', [binary, '-verify_arch', architecture]);
    return describeFile(binary).sha256;
  }
  try {
    run('ditto', ['-x', '-k', path.join(directory, `Manycode-${m.version}-universal.zip`), path.join(temporary, 'zip')]);
    const zipHash = appCheck(path.join(temporary, 'zip/manycode.app'));
    const dmg = path.join(directory, `Manycode-${m.version}-universal.dmg`);
    if (m.signing === 'notarized') {
      run('xcrun', ['stapler', 'validate', dmg]);
      run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmg]);
    }
    fs.mkdirSync(mount);
    run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg]);
    mounted = true;
    if (appCheck(path.join(mount, 'manycode.app')) !== zipHash) throw new Error('ZIP and DMG contain different app binaries');
    return m;
  } finally {
    if (mounted) run('hdiutil', ['detach', mount]);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
if (require.main === module) {
  try { const m = verifyRelease(path.resolve(process.argv[2] || `app/.build/releases/${require('../package.json').version}-universal`)); console.log(`Verified ${m.version}: ${m.signing} signature policy, architectures, hashes, packaged versions`); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { verifyManifest, verifyRelease };
