import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const base = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => readFileSync(resolve(base, p), 'utf8');
const config = JSON.parse(load('src-tauri/tauri.conf.json'));
const rust = load('src-tauri/src/main.rs');
const html = load('ui/index.html');
const css = load('ui/startup.css');
const link = load('ui/discovery-link.js');

test('Windows menu bar is removed and the right webview is preloaded', () => {
  assert.doesNotMatch(rust, /app\.set_menu\s*\(/);
  assert.match(rust, /WindowBuilder::new\(app, "main"\)/);
  assert.match(rust, /WebviewBuilder::new\("jellyfin"/);
  assert.match(rust, /WebviewUrl::App\("index.html"/);
  assert.match(rust, /remote\.hide\(\)\?/);
  assert.match(rust, /remote\.show\(\)/);
  assert.match(rust, /shell\.hide\(\)/);
  assert.equal(config.build.frontendDist, '../ui');
  assert.deepEqual(config.app.windows, []);
});

test('startup reveals Jellyfin only after login/home DOM is ready and update checked', () => {
  assert.match(rust, /remote_ready\.load\(Ordering::Acquire\)/);
  assert.match(rust, /updates_ready\.load\(Ordering::Acquire\)/);
  assert.match(rust, /live_presented\.swap\(true, Ordering::AcqRel\)/);
  assert.match(rust, /eval_with_callback\(LIVE_READY_PROBE/);
  assert.match(rust, /tokio::sync::mpsc::unbounded_channel/);
  assert.match(rust, /Duration::from_millis\(350\)/);
  assert.match(rust, /input\[type="password"\]/);
  assert.match(rust, /document\.querySelector\('\.homePage'\)/);
  assert.match(rust, /UPDATE_CHECK_TIMEOUT/);
  assert.match(rust, /UPDATE_DOWNLOAD_TIMEOUT/);
});

test('warm reopen preserves actual Jellyfin DOM while explicit quit is possible', () => {
  assert.match(rust, /tauri_plugin_single_instance::init/);
  assert.match(rust, /WindowEvent::CloseRequested/);
  assert.match(rust, /api\.prevent_close\(\)/);
  assert.match(rust, /main_for_close\.hide\(\)/);
  assert.match(rust, /"quit" => app\.exit\(0\)/);
  assert.match(rust, /"discover" => route_discover\(app\)/);
});

test('offline shell has no password, personal cache, remote scripts or loading spinner', () => {
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /frame-src 'none'/);
  assert.match(html, /vyneo:\/\/retry/);
  assert.match(html, /https:\/\/vyneo-preview\.visyren\.fr\/app\/secure\.html/);
  assert.doesNotMatch(html + css, /<script|<iframe|vy-loading|vy-spin/);
  assert.doesNotMatch(html + css, /\banimation\s*:/);
  assert.equal(config.app.withGlobalTauri, false);
  assert.deepEqual(config.app.security.capabilities, []);
});

test('native in-page discovery link is injected only on the Jellyfin origin', () => {
  function execute(origin, password = false) {
    const elements = new Map();
    const handlers = {};
    const document = {
      readyState: 'complete',
      fullscreenElement: null,
      body: {
        append(el) {
          elements.set(el.id, el);
        }
      },
      getElementById(id) { return elements.get(id) || null; },
      querySelector(query) {
        return query === 'input[type="password"]' && password ? {} : null;
      },
      querySelectorAll() { return []; },
      createElement(tag) {
        assert.equal(tag, 'a');
        return {
          id: null,
          style: {},
          setAttribute() {},
        };
      },
      addEventListener(type, cb) { handlers[type] = cb; },
    };
    const window = { location: { origin } };
    window.top = window;
    vm.runInNewContext(link, { window, document, setInterval() {} });
    return elements.get('vyneo-desktop-discovery-link') || null;
  }
  assert.equal(execute('https://untrusted.example'), null);
  const linkUnauthed = execute('https://cocojellyfin.duckdns.org:38443', true);
  assert.equal(linkUnauthed.style.display, 'none');
  const linkAuthed = execute('https://cocojellyfin.duckdns.org:38443');
  assert.equal(linkAuthed.href,
    'https://vyneo-preview.visyren.fr/app/secure.html');
  assert.equal(linkAuthed.style.display, '');
  assert.doesNotMatch(link, /__TAURI__|localStorage|document\.cookie|jellyfin\.token/i);
});
