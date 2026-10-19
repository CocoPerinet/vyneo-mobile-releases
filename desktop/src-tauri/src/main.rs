#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod quality_policy;

use std::time::Duration;
use tauri::{
    menu::MenuBuilder,
    tray::TrayIconBuilder,
    webview::WebviewWindowBuilder,
    Manager, WebviewUrl, WindowEvent,
};
use tauri_plugin_updater::UpdaterExt;

const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(3);
const UPDATE_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30);

// The bundled Svelte/TypeScript app owns all UI and talks directly to
// the Jellyfin media API. We never run the external Jellyfin browser SPA.
async fn check_signed_update(app: tauri::AppHandle) {
    let check = tokio::time::timeout(UPDATE_CHECK_TIMEOUT, async {
        let updater = app.updater()?;
        updater.check().await
    }).await;
    if let Ok(Ok(Some(update))) = check {
        let package = tokio::time::timeout(
            UPDATE_DOWNLOAD_TIMEOUT,
            update.download(|_, _| {}, || {}),
        ).await;
        if let Ok(Ok(bytes)) = package {
            // Minisign is checked before installation and the tag must
            // match the signed version. Do not cancel installs mid-write.
            if update.install(&bytes).is_ok() {
                #[cfg(not(target_os = "windows"))]
                app.restart();
                #[cfg(target_os = "windows")]
                return;
            }
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let main = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("Vynéo")
            .inner_size(1280.0, 800.0)
            .min_inner_size(860.0, 560.0)
            .center()
            .on_navigation(|url| {
                (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                    || (url.scheme() == "http"
                        && url.host_str() == Some("tauri.localhost"))
            })
            .build()?;

            let close_target = main.clone();
            main.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    // Warm close preserves our OWN Vynéo DOM, not Jellyfin Web.
                    // Video is paused before hiding to avoid invisible playback.
                    api.prevent_close();
                    let _ = close_target.eval(
                        "document.querySelectorAll('video').forEach(v => v.pause())",
                    );
                    let _ = close_target.hide();
                }
            });

            let tray_menu = MenuBuilder::new(app)
                .text("open", "Ouvrir Vynéo")
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
                            if let Some(main) = app.get_webview_window("main") {
                                let _ = main.show();
                                let _ = main.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .build(app)?;
            }
            tauri::async_runtime::spawn(check_signed_update(app.handle().clone()));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Impossible de démarrer Vynéo");
}
