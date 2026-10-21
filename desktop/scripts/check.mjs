import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>readFileSync(resolve(root,file),"utf8");
const conf=JSON.parse(read("src-tauri/tauri.conf.json"));
const release=JSON.parse(read("src-tauri/tauri.release.conf.json"));
const preview=JSON.parse(read("src-tauri/tauri.preview.conf.json"));
const pkg=JSON.parse(read("package.json"));
const lock=JSON.parse(read("package-lock.json"));
const mobile=JSON.parse(read("../update-manifest.json"));
const cargo=read("src-tauri/Cargo.toml");
const rust=read("src-tauri/src/main.rs");
const html=read("frontend/index.html");
const api=read("frontend/src/api.ts");
const app=read("frontend/src/App.svelte");
const source=read("frontend/src/index.ts");
const nativeToken=read("frontend/src/styles.css");

assert.equal(conf.productName,"Vynéo");
assert.equal(conf.identifier,"fr.visyren.vyneo.desktop");
assert.equal(conf.version,pkg.version);
assert.match(pkg.version,/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/);
assert.equal(lock.version,pkg.version);
assert.equal(lock.packages[""].version,pkg.version);
assert.equal(/^version = "([^"]+)"$/m.exec(cargo)?.[1],pkg.version);
assert.ok(api.includes('Version="'+pkg.version+'"'));
assert.match(cargo,/^tauri = \{ version = "=2\.12\.4"/m);
assert.match(cargo,/^tauri-plugin-updater = "=2\.14\.0"$/m);
// Tauri's CLI may normalize this pinned dependency to an equivalent TOML
// inline table during native packaging. Both syntaxes keep the same exact pin.
assert.match(cargo,/^tauri-build = (?:"=2\.7\.3"|\{ version = "=2\.7\.3", features = \[\] \})$/m);
assert.equal(conf.build.frontendDist,"../frontend/dist");
assert.deepEqual(conf.app.windows,[]);
assert.equal(conf.app.withGlobalTauri,false);
assert.deepEqual(conf.app.security.capabilities,[]);
assert.equal(conf.bundle.createUpdaterArtifacts,false);
assert.equal(release.bundle.createUpdaterArtifacts,true);
// Preview is a different installed app, not an upgrade of stable.
assert.equal(preview.productName,"Vynéo Preview");
assert.equal(preview.identifier,"fr.visyren.vyneo.desktop.preview");
assert.match(preview.version,/^0\.2\.0-beta\.[1-9][0-9]*$/);
assert.equal(preview.bundle.createUpdaterArtifacts,false);
assert.deepEqual(preview.plugins.updater.endpoints,[
  "https://raw.githubusercontent.com/CocoPerinet/vyneo-mobile-releases/main/desktop-preview-{{target}}-{{arch}}.json"
]);
assert.ok(!Object.prototype.hasOwnProperty.call(preview.plugins.updater,"pubkey"));
assert.equal(conf.plugins.updater.requireSignedVersion,true);
assert.equal(conf.plugins.updater.allowDowngrades,false);
assert.equal(conf.plugins.updater.windows.installMode,"passive");
assert.match(conf.plugins.updater.pubkey,/^[A-Za-z0-9+/=]{80,}$/);
assert.deepEqual(conf.plugins.updater.endpoints,[
  "https://raw.githubusercontent.com/CocoPerinet/vyneo-mobile-releases/main/desktop-{{target}}-{{arch}}.json"
]);
assert.match(rust,/WebviewUrl::App\("index\.html"\.into\(\)\)/);
assert.match(rust,/tauri_plugin_single_instance::init/);
assert.match(rust,/tauri_plugin_updater/);
assert.match(rust,/WindowEvent::CloseRequested/);
assert.doesNotMatch(rust,/WebviewUrl::External|app\.set_menu\(/);
assert.doesNotMatch(rust,/vyneo-preview\.visyren|\/web\/index\.html|inject\.js/);
assert.match(html,/connect-src 'self' https:\/\/cocojellyfin\.duckdns\.org:38443/);
assert.doesNotMatch(html,/<iframe|src="https:\/\/cocojellyfin/i);
assert.match(api,/SERVER_ORIGIN="https:\/\/cocojellyfin\.duckdns\.org:38443"/);
assert.match(api,/credentials:"omit"/);
assert.match(api,/this\.token=null/);
assert.doesNotMatch(api,/api_key|tokenInBrowser/i);
assert.match(app,/buildShelves\(/);
assert.match(app,/<MediaCard/);
assert.match(nativeToken,/--vy-bg:#0a0c11/);
assert.match(source,/import App from "\.\/App\.svelte"/);
assert.ok(existsSync(resolve(root,"frontend/vite.config.ts")));
assert.ok(existsSync(resolve(root,"frontend/tsconfig.json")));
assert.equal(mobile.schemaVersion,1);
assert.equal(mobile.platforms.android.url.includes("mobile-v"),true);
const tag=process.env.GITHUB_REF_TYPE==="tag"?
  process.env.GITHUB_REF_NAME:null;
if(tag){
  if(tag.startsWith("desktop-preview-v"))
    assert.equal(tag,"desktop-preview-v"+preview.version);
  else
    assert.equal(tag,"desktop-v"+pkg.version);
}
console.log("VYNEO_NATIVE_UI_CONTRACT_OK: local Svelte UI, Jellyfin API, updater signed, Mobile intact");
