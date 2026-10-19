#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod quality_policy;

use std::time::Duration;
use tauri::{menu::MenuBuilder, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_updater::UpdaterExt;

const DISCOVERY_URL: &str =
    "https://vyneo-preview.visyren.fr/app/secure.html";

/// Checks before showing the player: never restart during a movie.
async fn update_before_playback(app: tauri::AppHandle) {
    let check = tokio::time::timeout(Duration::from_secs(3), async {
        let updater = app.updater()?;
        updater.check().await
    })
    .await;

    if let Ok(Ok(Some(update))) = check {
        // Tauri validates the minisign signature against the embedded
        // public key before executing or installing any downloaded code.
        if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
            #[cfg(not(target_os = "windows"))]
            app.restart();
            // On Windows the updater itself exits, runs the installer,
            // then relaunches the application (no second restart).
            return;
        }
    }

    // Offline, no update, invalid response or failed installation:
    // always restore the normal Jellyfin UI without logging the user out.
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
