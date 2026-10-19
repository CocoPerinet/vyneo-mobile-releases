#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod quality_policy;

use std::time::Duration;
use tauri::{menu::MenuBuilder, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_updater::UpdaterExt;

const DISCOVERY_URL: &str =
    "https://vyneo-preview.visyren.fr/app/secure.html";

const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(3);
const UPDATE_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30);

/// The check/download happen BEFORE the Jellyfin player becomes interactive.
/// Bound both network phases, so a stalled release server cannot leave a
/// permanently invisible application. Never cancel an installation mid-write.
async fn update_before_playback(app: tauri::AppHandle) {
    let check = tokio::time::timeout(UPDATE_CHECK_TIMEOUT, async {
        let updater = app.updater()?;
        updater.check().await
    }).await;

    if let Ok(Ok(Some(update))) = check {
        // Downloads and verifies the minisign signature; cancellation during
        // this phase cannot interrupt installation of the old binary.
        let verified_download = tokio::time::timeout(
            UPDATE_DOWNLOAD_TIMEOUT,
            update.download(|_, _| {}, || {}),
        ).await;

        if let Ok(Ok(bytes)) = verified_download {
            // Install is synchronous and invoked only after a FULL verified
            // download. Do NOT timeout/cancel installation mid-write.
            if update.install(&bytes).is_ok() {
                #[cfg(not(target_os = "windows"))]
                app.restart();
                // Windows updater exits/relaunches after a successful
                // installer spawn. Never restart Windows a second time.
                return;
            }
        }
    }

    // Offline, slow download, corrupt signature or install failure:
    // preserve the old working version and show the normal Jellyfin UI.
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        // No JavaScript updater bindings or permissions for remote pages.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let menu = MenuBuilder::new(app)
                .text("library", "Bibliothèque Jellyfin")
                .text("discover", "Découvrir avec l'IA · Top 10")
                .build()?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| match event.id().0.as_str() {
                "library" => {
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                }
                "discover" => {
                    if let Some(existing) = app.get_webview_window("discovery") {
                        let _ = existing.show();
                        let _ = existing.set_focus();
                    } else if let Ok(url) = DISCOVERY_URL.parse() {
                        // Separate session boundary: only the secured BFF
                        // can access the per-user IA recommendations.
                        let _ = WebviewWindowBuilder::new(
                            app,
                            "discovery",
                            WebviewUrl::External(url),
                        )
                        .title("Vynéo · Découvertes IA")
                        .inner_size(1200.0, 800.0)
                        .build();
                    }
                }
                _ => {}
            });

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(update_before_playback(handle));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Impossible de démarrer Vynéo");
}
