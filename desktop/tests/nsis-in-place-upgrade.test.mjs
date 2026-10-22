import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const workflow=read('../.github/workflows/desktop.yml').replace(/\r\n/g,'\n');
const runner=read('qa/nsis-in-place-upgrade.ps1');

test('disposable PR Windows runner alone can test NSIS in-place upgrades',()=>{
  const prJob=workflow.split('  windows_preview:\n')[1]
    .split('  windows_release:\n')[0];
  const stableJob=workflow.split('  windows_release:\n')[1]
    .split('  macos_preview:\n')[0];
  assert.match(prJob,/Verify stable NSIS upgrades in place without installing on COCO/);
  assert.match(prJob,/if: github.event_name == 'pull_request'/);
  assert.match(prJob,/run: \.\/qa\/nsis-in-place-upgrade\.ps1/);
  assert.doesNotMatch(stableJob,/nsis-in-place-upgrade\.ps1/);
  assert.match(runner,/GITHUB_ACTIONS -ne 'true'/);
  assert.match(runner,/RUNNER_OS -ne 'Windows'/);
  assert.match(runner,/RUNNER_ENVIRONMENT -ne 'github-hosted'/);
  assert.match(runner,/GITHUB_EVENT_NAME -ne 'pull_request'/);
  assert.match(runner,/GITHUB_REPOSITORY -ne 'CocoPerinet\/vyneo-mobile-releases'/);
  assert.match(runner,/RUNNER_ALREADY_HAS_VYNEO_INSTALLED/);
  assert.match(runner,/CURRENT_USER|Get-InstalledVyneo/);
});
test('upgrade QA installs the last signed stable first, checks one slot and preserves data',()=>{
  assert.match(runner,/gh release list -R \$repo/);
  assert.match(runner,/\^desktop-v\\d\+\\\.\\d\+\\\.\\d\+\$/);
  assert.match(runner,/gh release download \$baselineTag/);
  assert.match(runner,/Vyneo-Desktop-\$\(\$baselineVersion\.ToString\(\)\)-windows-x64\.exe/);
  assert.match(runner,/npm run tauri -- build --bundles nsis --config \$config/);
  assert.match(runner,/bundle = @\{ createUpdaterArtifacts = \$false \}/);
  assert.match(runner,/Start-Process -FilePath \$exe -ArgumentList '\/S' -Wait/);
  assert.match(runner,/Require-One \(\$baselineVersion\.ToString\(\)\)/);
  assert.match(runner,/Require-One \$upgradeVersion/);
  assert.match(runner,/UPGRADE_CHANGED_UNINSTALL_KEY_CREATED_SECOND_APP/);
  assert.match(runner,/UPGRADE_CHANGED_INSTALL_DIRECTORY/);
  assert.match(runner,/UPGRADE_DID_NOT_REPLACE_BINARY/);
  assert.match(runner,/UPGRADE_LOST_USER_DATA/);
  assert.match(runner,/VYNEO_WINDOWS_NSIS_IN_PLACE_UPGRADE_PASS/);
  assert.match(runner,/finally \{/);
  assert.doesNotMatch(runner,/gh release (create|upload)/);
  assert.doesNotMatch(runner,/TAURI_SIGNING_PRIVATE_KEY|signingKey/i);
});
