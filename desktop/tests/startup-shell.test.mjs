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
const qa=JSON.parse(read("src-tauri/tauri.jellyfin-qa.conf.json"));
const credentials=read("src-tauri/src/credentials.rs");

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
  assert.match(rust,/request_window_action\(close_target\.clone\(\), "hide"\)/);
  assert.match(rust,/tauri_plugin_single_instance::init/);
  assert.match(rust,/request_window_action\(main, "quit"\)/);
  assert.match(rust,/fn reserve_window_action/);
  assert.match(rust,/fn release_window_action/);
  assert.match(rust,/pending == 2 && code == 1/);
  assert.match(rust,/fn quit_preempts_pending_hide_and_stale_hide_ack/);
  assert.match(rust,/complete_window_action/);
  assert.match(app,/invoke\("complete_window_action",\{action,generation\}\)/);
  assert.match(app,/acknowledgeNativeWindowAction\(event,window/);
  assert.doesNotMatch(app,/nativeActionBusy/);
  assert.match(app,/await flushActivePlayback\(window\)/);
  const detail=read("frontend/src/MediaDetails.svelte");
  assert.match(detail,/detail\.waitUntil\(finished\.drain\(\)\)/);
  assert.match(detail,/function closeDetails\(\)/);
  assert.match(detail,/if\(finished\)\{/);
  assert.match(detail,/else finished\.stopAtLastKnownPosition\(failed\)/);
  assert.match(detail,/stopPlaybackBeforeClosing\(\(\)=>stopStream\(\),onclose\)/);
  assert.match(detail,/onclick=\{closeDetails\}/);
  assert.match(detail,/event\.preventDefault\(\);closeDetails\(\)/);
  assert.doesNotMatch(detail,/onclick=\{onclose\}/);
});
test("local frontend restricts network and never stores access tokens",()=>{
  assert.match(html,/Content-Security-Policy/);
  assert.match(html,/connect-src 'self' ipc: http:\/\/ipc\.localhost https:\/\/cocojellyfin\.duckdns\.org:38443/);
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
  // The rank renderer was extracted into the reusable native rail.
  const rail=read("frontend/src/ShelfRail.svelte");
  assert.match(app,/ShelfRail/);
  assert.match(rail,/shelf\.kind===\"top10\"/);
});
test("parity QA identity and credentials stay isolated",()=>{
  assert.equal(qa.identifier,"fr.visyren.vyneo.desktop.jellyfinqa");
  assert.notEqual(qa.identifier,cfg.identifier);
  assert.equal(qa.productName,"Vynéo Jellyfin QA");
  assert.equal(qa.bundle.createUpdaterArtifacts,false);
  assert.deepEqual(qa.plugins.updater.endpoints,[
    "https://127.0.0.1:9/qa-updates-disabled.json"]);
  assert.match(credentials,/fr\.visyren\.vyneo\.desktop\.jellyfinqa\.jellyfin/);
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
