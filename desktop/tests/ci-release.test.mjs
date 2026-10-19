import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const base = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(resolve(base, '.github/workflows/desktop.yml'), 'utf8');
const releaseConfig = JSON.parse(readFileSync(
  resolve(base, 'desktop/src-tauri/tauri.release.conf.json'), 'utf8'));

test('macOS release builds the updater-ready .app and the installable .dmg', () => {
  assert.match(workflow,
    /name: Build signed macOS updater and DMG[\s\S]*?build --bundles app,dmg --config src-tauri\/tauri.release.conf.json/);
  assert.match(workflow,
    /if \[\[ -z "\$archive" \|\| ! -f "\$archive\.sig" \|\| -z "\$dmg" \]\]; then/);
  assert.equal(releaseConfig.bundle.createUpdaterArtifacts, true);
});

test('PR preview cannot sign or publish and release jobs use tags only', () => {
  const preview = workflow.split('  windows_preview:\n')[1].split('  windows_release:\n')[0];
  const mac = workflow.split('  macos_preview:\n')[1].split('  macos_release:\n')[0];
  for (const block of [preview, mac]) {
    assert.match(block, /contents: read/);
    assert.doesNotMatch(block, /secrets\./);
    assert.doesNotMatch(block, /gh release upload/);
  }
  for (const job of ['windows_release', 'macos_release']) {
    const block = workflow.split('  ' + job + ':\n')[1];
    assert.ok(block);
    assert.match(block, /refs\/tags\/desktop-v/);
    assert.match(block, /contents: write/);
    assert.match(block, /TAURI_SIGNING_PRIVATE_KEY/);
  }
});

test('all github release CLI invocations receive an explicit repository', () => {
  assert.match(workflow, /env:\n  GH_REPO: CocoPerinet\/vyneo-mobile-releases/);
  assert.match(workflow, /prepare:[\s\S]*?gh release create/);
});
