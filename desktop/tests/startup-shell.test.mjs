import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";

const base=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=(name)=>readFileSync(resolve(base,name),"utf8");
const cfg=JSON.parse(read("src-tauri/tauri.conf.json"));
const rust=read("src-tauri/src/main.rs");
const html=read("frontend/index.html");
const app=read("frontend/src/App.svelte");
const api=read("frontend/src/api.ts");

test("native UI is bundled locally, never imports Jellyfin Web",()=>{
  assert.equal(cfg.build.frontendDist,"../frontend/dist");
  assert.match(rust,/WebviewUrl::App\("index\.html"\.into\(\)\)/);
  assert.doesNotMatch(rust,/WebviewUrl::External/);
  assert.doesNotMatch(rust,/\/web\/index\.html/);
  assert.doesNotMatch(app,/iframe|inject\.js|skin\.css/);
  assert.deepEqual(cfg.app.security.capabilities,[]);
  assert.equal(cfg.app.withGlobalTauri,false);
});
test("native menu bar removed, tray keeps Vynéo UI warm",()=>{
  assert.doesNotMatch(rust,/app\.set_menu/);
  assert.match(rust,/WindowEvent::CloseRequested/);
  assert.match(rust,/api\.prevent_close\(\)/);
  assert.match(rust,/close_target\.hide\(\)/);
  assert.match(rust,/tauri_plugin_single_instance::init/);
  assert.match(rust,/"quit" => app\.exit\(0\)/);
  assert.match(rust,/v\.pause\(\)/);
});
test("local frontend restricts network and never stores access tokens",()=>{
  assert.match(html,/Content-Security-Policy/);
  assert.match(html,/connect-src 'self' https:\/\/cocojellyfin\.duckdns\.org:38443/);
  assert.match(html,/frame-src 'none'/);
  assert.match(html,/object-src 'none'/);
  assert.doesNotMatch(html,/https:\/\/.*\/web\/index\.html/);
  assert.match(api,/credentials:"omit"/);
  assert.doesNotMatch(api,/api_key|localStorage\.setItem\(["']token/);
});
test("cross-account state resets and discovery sections are first-party",()=>{
  assert.match(app,/api\.logout\(\);artwork\.clear\(\)/);
  assert.match(app,/buildShelves\(data,session\.userId\)/);
  assert.match(app,/\"home\"/);
  assert.match(app,/\"universes\"/);
  assert.match(app,/\"favorites\"/);
  assert.match(app,/\"top10\"/);
});
test("signed updater and release separation remain available",()=>{
  assert.match(rust,/UPDATE_CHECK_TIMEOUT/);
  assert.match(rust,/UPDATE_DOWNLOAD_TIMEOUT/);
  assert.match(rust,/update\.download\(/);
  assert.match(rust,/update\.install\(&bytes\)/);
  assert.match(rust,/tauri_plugin_updater/);
  assert.equal(cfg.plugins.updater.requireSignedVersion,true);
  assert.equal(cfg.plugins.updater.allowDowngrades,false);
});
