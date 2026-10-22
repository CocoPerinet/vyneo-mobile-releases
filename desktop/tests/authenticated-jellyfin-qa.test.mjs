import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const cfg=JSON.parse(read("src-tauri/tauri.authenticated-qa.conf.json"));
const stable=JSON.parse(read("src-tauri/tauri.conf.json"));
const synthetic=JSON.parse(read("src-tauri/tauri.jellyfin-qa.conf.json"));
const preview=JSON.parse(read("src-tauri/tauri.preview.conf.json"));
const cargo=read("src-tauri/Cargo.toml");
const main=read("src-tauri/src/main.rs");
const vault=read("src-tauri/src/credentials.rs");
const client=read("frontend/src/App.svelte");
const updater=read("frontend/src/native-updater.ts");
const runner=read("qa/prepare-authenticated-jellyfin-qa.ps1");
const launcher=read("qa/launch-authenticated-jellyfin-qa.ps1");

test("authenticated real Jellyfin QA is a distinct unbundled debug-only identity",()=>{
  assert.equal(cfg.identifier,"fr.visyren.vyneo.desktop.authqa");
  for(const app of [stable,synthetic,preview])
    assert.notEqual(cfg.identifier,app.identifier);
  assert.equal(cfg.build.frontendDist,"../frontend/dist");
  assert.equal(cfg.bundle.createUpdaterArtifacts,false);
  assert.equal(cfg.plugins.updater.endpoints.length,1);
  assert.equal(cfg.plugins.updater.endpoints[0],
    "https://127.0.0.1:9/qa-updates-disabled.json");
  assert.match(cargo,/^interactive-jellyfin-qa = \[\]$/m);
  assert.doesNotMatch(cargo,/^default = \[[^\]]*interactive-jellyfin-qa/m);
  assert.match(main,/cfg\(all\(feature="interactive-jellyfin-qa", not\(debug_assertions\)\)\)/);
  assert.match(main,/compile_error!\("Interactive Jellyfin QA is restricted to unsigned debug builds"\)/);
  assert.match(main,/INTERACTIVE_QA_IDENTITY_MISMATCH/);
  assert.match(main,/if interactive_qa\(\) !=/);
  assert.match(main,/if cfg!\(feature="native-e2e-qa"\) \|\| interactive_qa\(\) \{ return Err\("UPDATE_DISABLED_IN_QA"\); \}/);
  assert.match(main,/if cfg!\(feature="native-e2e-qa"\) \|\| interactive_qa\(\) \{ return; \}/);
  assert.match(main,/if !cfg!\(feature="native-e2e-qa"\) && !interactive_qa\(\)/);
  assert.match(main,/if interactive_qa\(\) \{ return; \}[\s\S]*?api\.prevent_close/);
});
test("real-user QA cannot read, write or clear any OS credential vault",()=>{
  assert.match(vault,/fn vault_disabled_in_qa\(/);
  assert.match(vault,/cfg!\(feature="interactive-jellyfin-qa"\)/);
  assert.match(vault,/if vault_disabled_in_qa\(&app\) \{\s*return Err\("VAULT_DISABLED_IN_QA"/);
  assert.match(vault,/if vault_disabled_in_qa\(&app\) \{ return Ok\(None\); \}/);
  assert.match(vault,/if vault_disabled_in_qa\(&app\) \{ return Ok\(\(\)\); \}/);
  assert.match(vault,/service\("fr.visyren.vyneo.desktop.authqa"\)\.is_err\(\)/);
  assert.match(main,/fn is_temporary_qa\(\) -> bool \{ interactive_qa\(\) \}/);
  assert.match(client,/temporaryQa=\(await invoke\("is_temporary_qa"\)\)===true/);
  assert.match(client,/api\.enableReadOnlyQa\(\)/);
  assert.match(client,/qaReadOnly=\{temporaryQa\}/);
  assert.match(read("frontend/src/MediaDetails.svelte"),
    /if\(!qaReadOnly\)\{\s*reporter=new PlaybackReporter/);
  assert.match(read("frontend/src/MediaDetails.svelte"),
    /disabled=\{qaReadOnly\|\|stateBusy\}/);
  assert.match(read("frontend/src/api.ts"),
    /if\(this\.readOnlyQa\)throw new Error\("QA_READ_ONLY"\)/);
  assert.match(client,/if\(temporaryQa\)\{[\s\S]*?rememberMe=false;credentialStored=false/);
  assert.match(client,/nativeVault\.available && !temporaryQa/);
  assert.match(client,/Version temporaire de test : aucune session mémorisée/);
  assert.match(updater,/UPDATE_DISABLED_IN_QA/);
});
test("QA preparation is build only on COCO, not a second app installation",()=>{
  assert.match(runner,/COMPUTERNAME -notin @\('JJJ','COCO'\)/);
  assert.match(runner,/EXACTLY_ONE_VYNEO_STABLE_024_REQUIRED/);
  assert.match(runner,/PSObject\.Properties\.Match\('DisplayName'\)\.Count -gt 0/);
  assert.match(runner,/Get-FileHash -LiteralPath \$stableExe -Algorithm SHA256/);
  assert.match(runner,/--debug --no-bundle --features interactive-jellyfin-qa --config/);
  assert.match(runner,/EXISTING_RUST_TOOLCHAIN_NOT_FOUND/);
  assert.match(runner,/cargoBefore = \[System.IO.File\]::ReadAllBytes\(\$cargoToml\)/);
  assert.match(runner,/\[System.IO.File\]::WriteAllBytes\(\$cargoToml,\$cargoBefore\)/);
  assert.doesNotMatch(runner,/git reset --hard|git clean -fd/);
  assert.match(runner,/AUTH_QA_PORTABLE_BINARY_MISSING/);
  assert.match(runner,/VYNEO_AUTHENTICATED_QA_COMPILED_NO_INSTALL_NO_LAUNCH/);
  assert.doesNotMatch(runner,/Start-Process|Register-ScheduledTask|Install-Package|winget install|gh release (create|upload)|TAURI_SIGNING_PRIVATE_KEY|save_saved_session/);
  assert.doesNotMatch(read("../.github/workflows/desktop.yml"),/interactive-jellyfin-qa|authenticated-qa/);
});

test("interactive session launcher requires approval, isolates and cleans its task",()=>{
  assert.match(launcher,/param\(\[switch\]\$Approved\)/);
  assert.match(launcher,/if \(-not \$Approved\) \{ throw 'AUTH_QA_USER_APPROVAL_REQUIRED' \}/);
  assert.match(launcher,/ONLY_AUTHORIZED_WINDOWS_COCO_QA/);
  assert.match(launcher,/STABLE_SINGLE_INSTALLATION_REQUIRED/);
  assert.match(launcher,/QA_ALREADY_RUNNING/);
  assert.match(launcher,/New-ScheduledTaskPrincipal[\s\S]*?-LogonType Interactive -RunLevel Limited/);
  assert.match(launcher,/New-ScheduledTaskSettingsSet -ExecutionTimeLimit[\s\S]*?-Minutes 15/);
  assert.match(launcher,/Get-ScheduledTask -TaskName 'VyneoAuthenticatedJellyfinQA\*'/);
  assert.match(launcher,/Actions\[0\]\.Execute -ceq \$exe/);
  assert.match(launcher,/Unregister-ScheduledTask -TaskName \$taskName -Confirm:\$false/);
  assert.match(launcher,/QA_QUICK_CONNECT_REQUIRES_HUMAN_APPROVAL/);
  assert.match(launcher,/QA_INTERACTIVE_WINDOW_FAILED_TO_START/);
  assert.doesNotMatch(launcher,/save_saved_session|AuthenticateWithQuickConnect|QuickConnect\/Connect|gh release|Install-Package|Copy-Item|\\AppData\\Local\\Vynéo\\vyneo-desktop\.exe/);
});
