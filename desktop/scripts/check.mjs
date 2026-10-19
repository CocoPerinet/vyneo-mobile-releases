import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(resolve(root, relative), 'utf8');
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const release = JSON.parse(read('src-tauri/tauri.release.conf.json'));
const pkg = JSON.parse(read('package.json'));
const mobile = JSON.parse(read('../update-manifest.json'));
const url = new URL(config.build.frontendDist);
const originalSkin = read('src-tauri/src/main.rs');

assert.equal(config.productName, 'Vynéo');
assert.equal(config.identifier, 'fr.visyren.vyneo.desktop');
assert.equal(config.version, pkg.version);
assert.equal(url.href, 'https://cocojellyfin.duckdns.org:38443/web/index.html');
assert.deepEqual(config.app.security.capabilities, []);
assert.equal(config.app.withGlobalTauri, false);
assert.equal(config.app.windows.length, 1);
assert.equal(config.app.windows[0].visible, false);
assert.equal(config.app.windows[0].label, 'main');
assert.equal(config.bundle.createUpdaterArtifacts, false);
assert.equal(release.bundle.createUpdaterArtifacts, true);
assert.ok(originalSkin.includes('vyneo-preview.visyren.fr/app/secure.html'));
assert.ok(originalSkin.includes('tauri_plugin_updater'));
assert.ok(originalSkin.includes('UPDATE_CHECK_TIMEOUT'));
assert.ok(originalSkin.includes('UPDATE_DOWNLOAD_TIMEOUT'));
assert.ok(originalSkin.includes('update.download('));
assert.ok(originalSkin.includes('update.install(&bytes)'));
assert.ok(!originalSkin.includes('update.download_and_install('));
const updater = config.plugins.updater;
assert.match(updater.pubkey, /^[A-Za-z0-9+/=]{80,}$/);
assert.deepEqual(updater.endpoints, [
  'https://raw.githubusercontent.com/CocoPerinet/vyneo-mobile-releases/main/desktop-{{target}}-{{arch}}.json'
]);
assert.equal(updater.windows.installMode, 'passive');
assert.equal(mobile.schemaVersion, 1);
assert.ok(mobile.platforms.android.url.includes('mobile-v'));
assert.ok(!originalSkin.includes('http://'));
const tag = process.env.GITHUB_REF_TYPE === 'tag'
  ? process.env.GITHUB_REF_NAME : null;
if (tag) assert.equal(tag, `desktop-v${pkg.version}`);
console.log('VYNÉO_DESKTOP_CONTRACT_OK: Jellyfin, IA, updater signé, Mobile intact');
