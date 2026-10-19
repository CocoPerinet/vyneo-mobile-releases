#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod quality_policy;

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use tauri::{
    menu::MenuBuilder,
    tray::TrayIconBuilder,
    webview::{PageLoadEvent, WebviewBuilder, WebviewWindowBuilder},
    window::WindowBuilder,
    AppHandle, LogicalPosition, Manager, WebviewUrl, WindowEvent,
};
use tauri_plugin_updater::UpdaterExt;

const JELLYFIN_URL: &str = "https://cocojellyfin.duckdns.org:38443/web/index.html";
const JELLYFIN_ORIGIN: &str = "https://cocojellyfin.duckdns.org:38443";
const DISCOVERY_URL: &str = "https://vyneo-preview.visyren.fr/app/secure.html";
const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(3);
const UPDATE_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30);

/// Never persist Jellyfin tokens, passwords, images or personalized media in
/// the app-side bootstrap. The normal Jellyfin/WebView2 profile stays intact.
#[derive(Default)]
struct StartupGate {
    shell_ready: AtomicBool,
    setup_ready: AtomicBool,
    remote_ready: AtomicBool,
    updates_ready: AtomicBool,
    live_presented: AtomicBool,
}

fn show_host_if_ready(app: &AppHandle, state: &Arc<StartupGate>) {
    if state.setup_ready.load(Ordering::Acquire)
        && state.shell_ready.load(Ordering::Acquire)
    {
        if let Some(window) = app.get_window("main") {
            let _ = window.show();
        }
    }
}

fn present_remote_if_ready(app: &AppHandle, state: &Arc<StartupGate>) {
    if !state.remote_ready.load(Ordering::Acquire)
        || !state.updates_ready.load(Ordering::Acquire)
        || state.live_presented.swap(true, Ordering::AcqRel)
    {
        return;
    }
    if let Some(remote) = app.get_webview("jellyfin") {
        if remote.show().is_ok() {
            if let Some(shell) = app.get_webview("bootstrap") {
                let _ = shell.hide();
            }
        } else {
            state.live_presented.store(false, Ordering::Release);
        }
    }
}

fn open_discover(app: AppHandle) {
    if let Some(existing) = app.get_webview_window("discovery") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return;
    }
    if let Ok(url) = DISCOVERY_URL.parse() {
        let _ = WebviewWindowBuilder::new(
            &app,
            "discovery",
            WebviewUrl::External(url),
        )
        .title("Vynéo · Découvertes IA")
        .inner_size(1200.0, 800.0)
        .build();
    }
}

fn route_discover(app: &AppHandle) {
    let handle = app.clone();
    // Creating a WebView synchronously inside a WebView2 navigation callback
    // can deadlock. Let the callback return first.
    std::thread::spawn(move || open_discover(handle));
}

fn is_jellyfin_url(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("cocojellyfin.duckdns.org")
        && url.port_or_known_default() == Some(38443)
}

const LIVE_READY_PROBE: &str = r#"(() => {
    if (window.location.origin !== 'https://cocojellyfin.duckdns.org:38443') {
        return false;
    }
    if (!document.body || document.readyState === 'loading') {
        return false;
    }
    return Boolean(
        document.querySelector('input[type="password"]') ||
        document.querySelector('.homePage') ||
        document.querySelector('.mainDrawer') ||
        document.querySelector('.skinHeader') ||
        document.querySelector('.loginPage')
    );
})()"#;

async fn probe_remote(app: AppHandle, state: Arc<StartupGate>) {
    // Wait for a real login/home document, not the WebView2 error page or a
    // page-load event fired before the Jellyfin SPA has actually rendered.
    let (ready_tx, mut ready_rx) = tokio::sync::mpsc::unbounded_channel::<bool>();
    for _ in 0..44 {
        if state.remote_ready.load(Ordering::Acquire) {
            return;
        }
        let Some(remote) = app.get_webview("jellyfin") else {
            return;
        };
        let tx = ready_tx.clone();
        // Keep a single queue for late WebView2 callbacks. A response taking
        // 500 ms must not be lost because an earlier 250 ms sleep expired.
        let _ = remote.eval_with_callback(LIVE_READY_PROBE, move |result| {
            let _ = tx.send(result.trim() == "true");
        });
        let answer = tokio::time::timeout(Duration::from_millis(350), async {
            loop {
                match ready_rx.recv().await {
                    Some(true) => return true,
                    Some(false) => continue,
                    None => return false,
                }
            }
        })
        .await;
        if matches!(answer, Ok(true)) {
            state.remote_ready.store(true, Ordering::Release);
            present_remote_if_ready(&app, &state);
            return;
        }
    }
    // Remain on the local, usable offline shell. Its retry link can reload
    // Jellyfin later. Never expose an uninitialized/error WebView in front.
}

async fn update_before_playback(app: AppHandle, state: Arc<StartupGate>) {
    // Update check/download run while the local shell is already visible.
    // Never interrupt a video after we have swapped to live Jellyfin.
    let check = tokio::time::timeout(UPDATE_CHECK_TIMEOUT, async {
        let updater = app.updater()?;
        updater.check().await
    }).await;

    if let Ok(Ok(Some(update))) = check {
        let downloaded = tokio::time::timeout(
            UPDATE_DOWNLOAD_TIMEOUT,
            update.download(|_, _| {}, || {}),
        ).await;

        if let Ok(Ok(bytes)) = downloaded {
            // The actual installation is never cancelled mid-write, and the
            // updater itself verifies the minisign signature & signed version.
            if update.install(&bytes).is_ok() {
                #[cfg(not(target_os = "windows"))]
                app.restart();
                #[cfg(target_os = "windows")]
                return;
            }
        }
    }
    state.updates_ready.store(true, Ordering::Release);
    present_remote_if_ready(&app, &state);
}

fn main() {
    tauri::Builder::default()
        // Register first: reopening the .exe focuses the same warm window,
        // preserving the exact last Jellyfin view and its browser session.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(main) = app.get_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
        }))
        // Never grant remote Jellyfin or Cloudflare pages native IPC access.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let gate = Arc::new(StartupGate::default());
            let handle = app.handle().clone();

            // Main native window starts without a menu strip. One window
            // hosts the immediate local shell AND the background webview.
            let main = WindowBuilder::new(app, "main")
                .title("Vynéo")
                .inner_size(1280.0, 800.0)
                .min_inner_size(860.0, 560.0)
                .center()
                .visible(false)
                .build()?;

            let main_for_close = main.clone();
            main.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    // Keep exact DOM, scroll, posters, playback state and
                    // WebView2 memory alive for an instant next reopen.
                    api.prevent_close();
                    if let Some(player) = main_for_close.get_webview("jellyfin") {
                        // Do not leave film audio playing invisibly in the tray.
                        let _ = player.eval(
                            "document.querySelectorAll('video').forEach(v => v.pause())",
                        );
                    }
                    let _ = main_for_close.hide();
                }
            });

            let tray_menu = MenuBuilder::new(app)
                .text("open", "Ouvrir Vynéo")
                .text("discover", "Découvrir avec l'IA · Top 10")
                .separator()
                .text("quit", "Quitter complètement")
                .build()?;
            if let Some(icon) = app.default_window_icon() {
                TrayIconBuilder::new()
                    .icon(icon.clone())
                    .menu(&tray_menu)
                    .show_menu_on_left_click(true)
                    .on_menu_event(|app, event| match event.id().0.as_str() {
                        "open" => {
                            if let Some(main) = app.get_window("main") {
                                let _ = main.show();
                                let _ = main.set_focus();
                            }
                        }
                        "discover" => route_discover(app),
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .build(app)?;
            }

            let scale = main.scale_factor()?;
            let inner = main.inner_size()?.to_logical::<f64>(scale);
            let shell_gate = gate.clone();
            let shell_app = handle.clone();
            let shell_nav_app = handle.clone();
            let _shell = main.add_child(
                WebviewBuilder::new(
                    "bootstrap",
                    WebviewUrl::App("index.html".into()),
                )
                .auto_resize()
                .on_page_load(move |_view, payload| {
                    if matches!(payload.event(), PageLoadEvent::Finished) {
                        shell_gate.shell_ready.store(true, Ordering::Release);
                        show_host_if_ready(&shell_app, &shell_gate);
                    }
                })
                .on_navigation(move |url| {
                    if url.scheme() == "vyneo" && url.host_str() == Some("retry") {
                        if let Some(remote) = shell_nav_app.get_webview("jellyfin") {
                            let _ = remote.reload();
                        }
                        return false;
                    }
                    if url.as_str() == DISCOVERY_URL {
                        route_discover(&shell_nav_app);
                        return false;
                    }
                    // Native Tauri origins differ by OS:
                    // Windows: http://tauri.localhost
                    // macOS:   tauri://localhost
                    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                        || (url.scheme() == "http"
                            && url.host_str() == Some("tauri.localhost"))
                }),
                LogicalPosition::new(0.0, 0.0),
                inner,
            )?;

            let remote_gate = gate.clone();
            let remote_app = handle.clone();
            let remote_nav_app = handle.clone();
            let url = JELLYFIN_URL.parse()?;
            let remote = main.add_child(
                WebviewBuilder::new("jellyfin", WebviewUrl::External(url))
                    .auto_resize()
                    .initialization_script(include_str!("../../ui/discovery-link.js"))
                    .on_page_load(move |_webview, payload| {
                        if matches!(payload.event(), PageLoadEvent::Finished)
                            && payload.url().as_str().starts_with(JELLYFIN_ORIGIN)
                        {
                            let state = remote_gate.clone();
                            let app = remote_app.clone();
                            tauri::async_runtime::spawn(probe_remote(app, state));
                        }
                    })
                    .on_navigation(move |url| {
                        if url.as_str() == DISCOVERY_URL {
                            route_discover(&remote_nav_app);
                            return false;
                        }
                        is_jellyfin_url(url)
                    }),
                LogicalPosition::new(0.0, 0.0),
                inner,
            )?;
            remote.hide()?;
            gate.setup_ready.store(true, Ordering::Release);
            show_host_if_ready(&handle, &gate);

            // Keep a bounded escape hatch even if a local shell event fails.
            let visibility_app = handle.clone();
            let visibility_gate = gate.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(3)).await;
                if !visibility_gate.shell_ready.load(Ordering::Acquire) {
                    if let Some(main) = visibility_app.get_window("main") {
                        let _ = main.show();
                    }
                }
            });

            tauri::async_runtime::spawn(update_before_playback(handle, gate));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Impossible de démarrer Vynéo");
}
