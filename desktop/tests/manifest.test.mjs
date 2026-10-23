import test from 'node:test';
import assert from 'node:assert/strict';
import { createManifest, compareVersions, ensureBoundSignedVersion } from '../scripts/manifest-lib.mjs';

function syntheticSignature(version) {
  // Deliberately NOT a cryptographic signature: tests only the publisher's
  // version-binding metadata preflight, never the updater's Ed25519 verifier.
  return Buffer.from('untrusted comment: test fixture\nAAAA\n' +
    'trusted comment: timestamp:123\tfile:fixture.exe\tversion:' + version +
    '\nAAAA\n').toString('base64');
}

const sample = {
  version: '0.1.1',
  platform: 'windows-x86_64',
  asset: 'Vyneo-Desktop-0.1.1-windows-x64.exe',
  signature: syntheticSignature('0.1.1')
};

test('signed URL and platform are exact and public', () => {
  const result = createManifest(sample);
  assert.equal(result.version, sample.version);
  assert.deepEqual(Object.keys(result.platforms), ['windows-x86_64']);
  assert.equal(result.platforms['windows-x86_64'].url,
    'https://github.com/CocoPerinet/vyneo-mobile-releases/releases/download/desktop-v0.1.1/Vyneo-Desktop-0.1.1-windows-x64.exe');
});

test('macOS archive variants remain independent', () => {
  for (const platform of ['darwin-aarch64', 'darwin-x86_64']) {
    const result = createManifest({...sample, platform,
      asset: 'Vyneo-Desktop-0.1.1-macos.app.tar.gz'});
    assert.ok(result.platforms[platform].url.endsWith('.app.tar.gz'));
  }
});

test('unsigned packages, malicious paths, and wrong formats fail closed', () => {
  const patches = [
    {signature: ''},
    {signature: 'not-a-valid-signature'},
    {platform: 'linux-x86_64'},
    {asset: '../upload.exe'},
    {asset: 'Vyneo-Desktop-0.1.1-evil.zip'},
    {version: '1.0.0-beta'},
  ];
  for (const patch of patches) {
    assert.throws(() => createManifest({...sample, ...patch}));
  }
});

test('never replace newer updates with older release manifests', () => {
  assert.equal(compareVersions('0.1.1', '0.1.0'), 1);
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
  assert.equal(compareVersions('0.1.0', '0.1.1'), -1);
  assert.throws(() => compareVersions('n/a', '0.1.0'));
});

test('large semver components cannot be rounded by JavaScript Number', () => {
  const first = '0.900719925474099.0';
  const second = '0.900719925474098.0';
  assert.equal(compareVersions(first, second), 1);
  assert.equal(compareVersions(second, first), -1);
  assert.equal(compareVersions(first, first), 0);
});

test('manifest rejects version spoofing and unbound signatures', () => {
  assert.equal(ensureBoundSignedVersion(syntheticSignature('0.1.1'), '0.1.1'), true);
  assert.throws(() => createManifest({
    ...sample,
    version: '0.1.2'
  }), /SIGNED_VERSION_MISMATCH/);
  assert.throws(() => createManifest({
    ...sample,
    signature: syntheticSignature('0.1.0')
  }), /SIGNED_VERSION_MISMATCH/);
  assert.throws(() => createManifest({
    ...sample,
    signature: Buffer.from('untrusted comment: broken').toString('base64')
  }));
});

test('bad semver and unbounded input must be rejected', () => {
  for (const value of [
    '1.0001.0', '1.2.3-beta', '1.2.9999999999999999',
    '99999999999999999999.2.3', '-1.2.3', true, null
  ]) {
    assert.throws(() => compareVersions(value, '1.2.3'));
    assert.throws(() => compareVersions('1.2.3', value));
  }
});
