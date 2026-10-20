#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod quality_policy;
mod credentials;
mod g7z_oauth;
mod g7z_native;

use std::time::Duration;
use tauri::{
    menu::MenuBuilder,
    tray::TrayIconBuilder,
    webview::WebviewWindowBuilder,
    Manager, WebviewUrl, WindowEvent,
};
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(10);
const UPDATE_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(180);

// The bundled Svelte/TypeScript app owns all UI and talks directly to
// the Jellyfin media API. We never run the external Jellyfin browser SPA.
async fn check_signed_update(app: tauri::AppHandle) {
    let check = tokio::time::timeout(UPDATE_CHECK_TIMEOUT, async {
        let updater = app.updater()?;
        updater.check().await
    }).await;
    if let Ok(Ok(Some(update))) = check {
        // Never install an unexpected update silently. The stable and Preview
        // editions each check their own distinct, signature-enforced feed.
        let (send, receive) = tokio::sync::oneshot::channel();
        app.dialog()
            .message(format!(
                "Vynéo {} est disponible. Installer cette mise à jour signée maintenant ?",
                update.version
            ))
            .title("Mise à jour Vynéo")
            .buttons(MessageDialogButtons::YesNo)
            .show(move |approved| { let _ = send.send(approved); });
        if !matches!(receive.await, Ok(true)) {
            return;
        }
        let package = tokio::time::timeout(
            UPDATE_DOWNLOAD_TIMEOUT,
            update.download(|_, _| {}, || {}),
        ).await;
        if let Ok(Ok(bytes)) = package {
            // The updater independently verifies minisign, its embedded
            // key, the signed version and platform before installing.
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
        .invoke_handler(tauri::generate_handler![
            credentials::save_saved_session,
            credentials::read_saved_session,
            credentials::forget_saved_session,
            g7z_native::g7z_begin,
            g7z_native::g7z_open_approval,
            g7z_native::g7z_complete,
            g7z_native::g7z_recommendations,
            g7z_native::g7z_is_linked,
            g7z_native::g7z_forget,
        ])
        .manage(g7z_native::Bridge::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
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
