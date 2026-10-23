import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync,
  existsSync, rmSync, chmodSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const publisher = resolve(dirname(fileURLToPath(import.meta.url)),
  '../scripts/release-manifest.mjs');
const repo = 'CocoPerinet/vyneo-mobile-releases';

function attemptPublish(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'vyneo-desktop-publish-test-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const fakeGh = join(bin, 'gh');
  // No remote GitHub calls: the stub models only GET and PUT to the exact
  // platform-specific manifest file inside this disposable directory.
  const mock = [
    '#!/usr/bin/env node',
    'const fs = require("node:fs");',
    'const args=process.argv.slice(2);',
    'if(args[0]!=="api") process.exit(9);',
    'if(args.includes("--method")) {',
    '  fs.writeFileSync(process.env.TEST_GH_PUT, fs.readFileSync(0,"utf8"));',
    '  process.exit(0);',
    '}',
    'if(!args[1].includes("/contents/desktop-")) process.exit(8);',
    'if(process.env.TEST_GH_EXISTING) {',
    '  process.stdout.write(process.env.TEST_GH_EXISTING);',
    '  process.exit(0);',
    '}',
    'process.stderr.write("HTTP 404\\n");',
    'process.exit(1);',
  ].join('\n') + '\n';
  writeFileSync(fakeGh, mock);
  chmodSync(fakeGh, 0o700);
  const asset = 'Vyneo-Desktop-0.1.1-windows-x64.exe';
  writeFileSync(join(root, asset), Buffer.alloc(150_000, 0x5a));
  const envelope = Buffer.from(
    'untrusted comment: synthetic publisher fixture\nAAAA\n' +
    'trusted comment: timestamp:1\tfile:artifact\tversion:' +
    (overrides.TEST_SIGNED_VERSION || '0.1.1') + '\nAAAA\n'
  ).toString('base64');
  writeFileSync(join(root, asset + '.sig'), envelope);
  const environment = {
    ...process.env,
    PATH: bin + ':' + process.env.PATH,
    GITHUB_REPOSITORY: repo,
    GITHUB_REF_TYPE: 'tag',
    GITHUB_REF_NAME: 'desktop-v0.1.1',
    VYNEO_RELEASE_PLATFORM: 'windows-x86_64',
    VYNEO_RELEASE_ASSET: asset,
    VYNEO_RELEASE_SIG: asset + '.sig',
    TEST_GH_PUT: join(root, 'post.json'),
    ...overrides
  };
  const run = spawnSync(process.execPath, [publisher], {
    cwd: root, env: environment, encoding: 'utf8',
    timeout: 8000
  });
  let put = null;
  if (existsSync(environment.TEST_GH_PUT)) {
    put = JSON.parse(readFileSync(environment.TEST_GH_PUT, 'utf8'));
  }
  rmSync(root, { recursive: true, force: true });
  return { run, put };
}

test('signed desktop release only publishes platform manifest, not Mobile', () => {
  const { run, put } = attemptPublish();
  assert.equal(run.status, 0, run.stderr);
  assert.ok(put);
  assert.ok(!put.sha, 'new manifest never overwrites unknown SHA');
  assert.match(put.message, /desktop/);
  const body = JSON.parse(Buffer.from(put.content, 'base64').toString());
  assert.equal(body.version, '0.1.1');
  assert.deepEqual(Object.keys(body.platforms), ['windows-x86_64']);
  assert.ok(body.platforms['windows-x86_64'].url.endsWith('.exe'));
});

test('old tagged release cannot downgrade an installed client', () => {
  const old = {
    type: 'file', sha: 'sample-sha',
    content: Buffer.from(JSON.stringify({ version: '0.1.2' }))
      .toString('base64')
  };
  const { run, put } = attemptPublish({
    TEST_GH_EXISTING: JSON.stringify(old)
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /UPDATE_DOWNGRADE_REFUSED/);
  assert.equal(put, null);
});

test('publisher refuses an artifact signed for a different app version', () => {
  const { run, put } = attemptPublish({
    TEST_SIGNED_VERSION: '0.1.2'
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /SIGNED_VERSION_MISMATCH/);
  assert.equal(put, null);
});

test('not a release tag or wrong GitHub repository cannot publish', () => {
  for (const overrides of [
    { GITHUB_REF_TYPE: 'branch' },
    { GITHUB_REF_NAME: 'mobile-v0.1.1' },
    { GITHUB_REPOSITORY: 'CocoPerinet/vyneo-mobile' },
    { VYNEO_RELEASE_SIG: '' }
  ]) {
    const { run, put } = attemptPublish(overrides);
    assert.notEqual(run.status, 0);
    assert.equal(put, null);
  }
});
