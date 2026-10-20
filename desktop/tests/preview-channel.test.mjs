import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync,
  chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { previewManifest, previewSignedVersion, comparePreviewVersions } from
  '../scripts/preview-manifest-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const desktop = resolve(root, 'desktop');
const read = file => readFileSync(resolve(root,file),'utf8');
const base = JSON.parse(read('desktop/src-tauri/tauri.conf.json'));
const preview = JSON.parse(read('desktop/src-tauri/tauri.preview.conf.json'));
const stableWorkflow = read('.github/workflows/desktop.yml').replace(/\r\n/g,'\n');
const betaWorkflow = read('.github/workflows/desktop-preview.yml').replace(/\r\n/g,'\n');
const rust = read('desktop/src-tauri/src/main.rs');
const publisher = resolve(desktop,'scripts/preview-manifest.mjs');
const version = preview.version;
const asset = 'Vyneo-Desktop-Preview-' + version + '-windows-x64.exe';
function signature(versionToSign=version) {
  const envelope = 'untrusted comment: synthetic signature fixture\nAAAA\n' +
    'trusted comment: timestamp:10\tfile:fixture\tversion:' +
    versionToSign + '\nAAAA\n';
  return Buffer.from(envelope).toString('base64');
}
const signed = {
  version,platform:'windows-x86_64',asset,signature:signature()
};
test('Preview app is an opt-in side-by-side identity with separate feed', () => {
  assert.equal(base.identifier, 'fr.visyren.vyneo.desktop');
  assert.equal(preview.identifier, base.identifier + '.preview');
  assert.notEqual(preview.productName, base.productName);
  assert.match(preview.version,/^0\.2\.0-beta\.[1-9]\d*$/);
  assert.deepEqual(preview.plugins.updater.endpoints,[
    'https://raw.githubusercontent.com/CocoPerinet/vyneo-mobile-releases/main/desktop-preview-{{target}}-{{arch}}.json'
  ]);
  assert.notDeepEqual(preview.plugins.updater.endpoints,
    base.plugins.updater.endpoints);
  assert.ok(!Object.hasOwn(preview.plugins.updater,'pubkey'));
  assert.equal(base.plugins.updater.requireSignedVersion,true);
  assert.equal(base.plugins.updater.allowDowngrades,false);
  assert.equal(preview.bundle.createUpdaterArtifacts,false);
  assert.equal(read('update-manifest.json').includes('mobile-v'),true);
});
test('Native updater offers a signed update instead of forcing install', () => {
  assert.match(rust,/tauri_plugin_dialog::init\(\)/);
  assert.match(rust,/MessageDialogButtons::YesNo/);
  assert.match(rust,/if !matches!\(receive\.await, Ok\(true\)\)/);
  assert.match(rust,/update\.download\(/);
  assert.match(rust,/update\.install\(&bytes\)/);
  assert.match(rust,/UPDATE_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs\(180\)/);
  assert.match(rust,/app\.restart\(\)/);
});
test('Preview build QA does not receive signing credentials', () => {
  const qa=stableWorkflow.split('  windows_preview:\n')[1]
    .split('  windows_release:\n')[0];
  assert.match(qa,/build --bundles nsis --config src-tauri\/tauri\.preview\.conf\.json/);
  assert.doesNotMatch(qa,/TAURI_SIGNING_PRIVATE_KEY|secrets\./);
  assert.match(betaWorkflow,/tags:\n\s+- "desktop-preview-v\*"/);
  assert.doesNotMatch(betaWorkflow,/desktop-v\*/);
  assert.match(betaWorkflow,/gh release create "\$GITHUB_REF_NAME"/);
  assert.match(betaWorkflow,/--verify-tag --prerelease/);
  assert.match(betaWorkflow,/Preview NSIS updater/);
  assert.match(betaWorkflow,/TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(betaWorkflow,/node scripts\/preview-manifest\.mjs/);
});
test('Strict signed Preview manifest cannot become a stable or mobile update', () => {
  const manifest = previewManifest(signed);
  assert.equal(manifest.version,'0.2.0-beta.1');
  assert.deepEqual(Object.keys(manifest.platforms),['windows-x86_64']);
  assert.equal(manifest.platforms['windows-x86_64'].url,
    'https://github.com/CocoPerinet/vyneo-mobile-releases/releases/download/' +
    'desktop-preview-v'+version+'/'+asset);
  assert.equal(previewSignedVersion(signature(),version),true);
  for(const unsafe of [
    {...signed,version:'0.2.0'},
    {...signed,version:'0.2.0-beta.0'},
    {...signed,version:'0.2.0-rc.1'},
    {...signed,asset:'Vyneo-Desktop-0.2.0-windows-x64.exe'},
    {...signed,asset:'../'+asset},
    {...signed,platform:'linux-x86_64'},
    {...signed,signature:''},
    {...signed,signature:signature('0.2.0-beta.2')}
  ])assert.throws(()=>previewManifest(unsafe));
  assert.equal(comparePreviewVersions('0.2.0-beta.2','0.2.0-beta.1'),1);
  assert.equal(comparePreviewVersions('0.2.1-beta.1','0.2.0-beta.999'),1);
  assert.equal(comparePreviewVersions('0.2.0-beta.1','0.2.0-beta.2'),-1);
  assert.throws(()=>comparePreviewVersions('0.2.0','0.2.0-beta.1'));
});

const linux=process.platform==='win32'?test.skip:test;
function runPublisher(overrides={}){
  const dir=mkdtempSync(join(tmpdir(),'vyneo-preview-manifest-test-'));
  const bin=join(dir,'bin');
  mkdirSync(bin);
  mkdirSync(join(dir,'src-tauri'));
  writeFileSync(join(dir,'src-tauri/tauri.preview.conf.json'),
    JSON.stringify(preview));
  writeFileSync(join(dir,asset),Buffer.alloc(151_000,0x4b));
  writeFileSync(join(dir,asset+'.sig'),signature());
  const fakeGh=join(bin,'gh');
  writeFileSync(fakeGh,[
    '#!/usr/bin/env node',
    'const fs=require("node:fs");',
    'const args=process.argv.slice(2);',
    'if(args[0]==="release") {',
    '  process.stdout.write(JSON.stringify({isPrerelease:process.env.TEST_NOT_PRERELEASE!=="1"}));',
    '  process.exit(0);',
    '}',
    'if(args[0]!=="api")process.exit(9);',
    'if(args.includes("--method")) {',
    '  fs.writeFileSync(process.env.TEST_PUT_PATH,fs.readFileSync(0,"utf8"));',
    '  fs.writeFileSync(process.env.TEST_ARGS_PATH,JSON.stringify(args));',
    '  process.exit(0);',
    '}',
    'if(!args[1].endsWith("/contents/desktop-preview-windows-x86_64.json"))',
    '  process.exit(8);',
    'if(process.env.TEST_EXISTING) {',
    '  process.stdout.write(process.env.TEST_EXISTING);process.exit(0);',
    '}',
    'process.stderr.write("HTTP 404\\n");process.exit(1);'
  ].join('\n')+'\n');
  chmodSync(fakeGh,0o700);
  const env={
    ...process.env, PATH:bin+':'+process.env.PATH,
    GITHUB_REPOSITORY:'CocoPerinet/vyneo-mobile-releases',
    GITHUB_REF_TYPE:'tag',
    GITHUB_REF_NAME:'desktop-preview-v'+version,
    VYNEO_RELEASE_PLATFORM:'windows-x86_64',
    VYNEO_RELEASE_ASSET:asset,
    VYNEO_RELEASE_SIG:asset+'.sig',
    TEST_PUT_PATH:join(dir,'post.json'),
    TEST_ARGS_PATH:join(dir,'args.json'),
    ...overrides
  };
  const result=spawnSync(process.execPath,[publisher],{
    cwd:dir,env,encoding:'utf8',timeout:10000
  });
  const put=existsSync(env.TEST_PUT_PATH)
    ?JSON.parse(readFileSync(env.TEST_PUT_PATH,'utf8')):null;
  const args=existsSync(env.TEST_ARGS_PATH)
    ?JSON.parse(readFileSync(env.TEST_ARGS_PATH,'utf8')):null;
  rmSync(dir,{recursive:true,force:true});
  return {result,put,args};
}
linux('Signed Preview publishes ONLY desktop-preview platform file on main',()=>{
  const {result,put,args}=runPublisher();
  assert.equal(result.status,0,result.stderr);
  assert.equal(put.branch,'main');
  assert.equal(put.sha,undefined);
  assert.ok(args.join(' ').includes('contents/desktop-preview-windows-x86_64.json'));
  assert.ok(!args.join(' ').includes('/contents/desktop-windows-x86_64.json'));
  assert.equal(JSON.parse(Buffer.from(put.content,'base64')).version,version);
});
linux('Preview publisher denies wrong context or release classification',()=>{
  for(const changes of [
    {GITHUB_REF_NAME:'desktop-v'+version},
    {GITHUB_REF_NAME:'desktop-preview-v0.2.0-beta.9'},
    {GITHUB_REF_TYPE:'branch'},
    {GITHUB_REPOSITORY:'other/repository'},
    {TEST_NOT_PRERELEASE:'1'}
  ]){
    const {result,put}=runPublisher(changes);
    assert.notEqual(result.status,0);
    assert.equal(put,null);
  }
});
linux('Preview publisher refuses overwrites with older or equal versions',()=>{
  const previous=version=>JSON.stringify({
    type:'file',sha:'fakeSha',
    content:Buffer.from(JSON.stringify({version})).toString('base64')
  });
  for(const old of ['0.2.0-beta.1','0.2.0-beta.2']){
    const {result,put}=runPublisher({TEST_EXISTING:previous(old)});
    assert.notEqual(result.status,0);
    assert.equal(put,null);
  }
});

