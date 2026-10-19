import test from 'node:test';
import assert from 'node:assert/strict';
import { createManifest, compareVersions } from '../scripts/manifest-lib.mjs';

const sample = {
  version: '0.1.1',
  platform: 'windows-x86_64',
  asset: 'Vyneo-Desktop-0.1.1-windows-x64.exe',
  signature: 'A'.repeat(140)
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
