#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod quality_policy;
mod credentials;
mod native_stream;
mod native_hls;
#[cfg(feature="native-e2e-qa")]
mod native_e2e_qa;

use std::time::Duration;
use std::sync::atomic::{AtomicBool, Ordering};
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

// Only one update check, download or installation may run per process.
// The permit also releases its lock if a future gets cancelled or times out.
static UPDATE_RUNNING: AtomicBool = AtomicBool::new(false);
struct UpdatePermit;
impl UpdatePermit {
    fn claim() -> Option<Self> {
        UPDATE_RUNNING.compare_exchange(false,true,
            Ordering::AcqRel,Ordering::Acquire).ok().map(|_|Self)
    }
}
impl Drop for UpdatePermit {
    fn drop(&mut self) {
        UPDATE_RUNNING.store(false,Ordering::Release);
    }
}

// The bundled Svelte/TypeScript app owns all UI and talks directly to
// the Jellyfin media API. We never run the external Jellyfin browser SPA.
async fn check_signed_update(
    app: tauri::AppHandle,
) -> Result<&'static str,&'static str> {
    // This must never attempt updater network access inside the isolated QA
    // executable; no credentials, release feed or second installation there.
    if cfg!(feature="native-e2e-qa") { return Err("UPDATE_DISABLED_IN_QA"); }
    let _permit=UpdatePermit::claim().ok_or("UPDATE_BUSY")?;
    let check=tokio::time::timeout(UPDATE_CHECK_TIMEOUT, async {
        let updater=app.updater()?;
        updater.check().await
    }).await;
    let update=match check {
        Ok(Ok(Some(update)))=>update,
        Ok(Ok(None))=>return Ok("up-to-date"),
        Ok(Err(_))=>return Err("UPDATE_CHECK_FAILED"),
        Err(_)=>return Err("UPDATE_CHECK_TIMEOUT"),
    };
    // Explicit approval remains mandatory for startup and manual checks.
    let (send,receive)=tokio::sync::oneshot::channel();
    app.dialog()
        .message(format!(
            "Vynéo {} est disponible. Installer cette mise à jour signée maintenant ?",
            update.version
        ))
        .title("Mise à jour Vynéo")
        .buttons(MessageDialogButtons::YesNo)
        .show(move |approved| { let _=send.send(approved); });
    if !matches!(receive.await, Ok(true)) {
        return Ok("declined");
    }
    let bytes=match tokio::time::timeout(
        UPDATE_DOWNLOAD_TIMEOUT,
        update.download(|_,_|{},||{}),
    ).await {
        Ok(Ok(bytes))=>bytes,
        Ok(Err(_))=>return Err("UPDATE_DOWNLOAD_FAILED"),
        Err(_)=>return Err("UPDATE_DOWNLOAD_TIMEOUT"),
    };
    // Signature verification is enforced by Tauri's updater plugin.
    // We never accept a URL or public key supplied by renderer JavaScript.
    update.install(&bytes).map_err(|_|"UPDATE_INSTALL_FAILED")?;
    #[cfg(not(target_os="windows"))]
    app.restart();
    Ok("install-started")
}

#[tauri::command]
async fn check_signed_update_now(
    app: tauri::AppHandle,
) -> Result<&'static str,String> {
    check_signed_update(app).await.map_err(str::to_owned)
}

fn main() {
    // Encrypted Jellyfin credentials stay with the vault; these temporary
    // media capabilities are entirely in memory and vanish on process exit.
    let media = std::sync::Arc::new(native_stream::Tickets::new()
        .expect("Cannot initialize secure Jellyfin client"));
    let protocol_media = media.clone();
    tauri::Builder::default()
        .manage(media)
        .register_asynchronous_uri_scheme_protocol(
            "vyneo-media", move |_ctx, request, responder| {
                let state = protocol_media.clone();
                std::thread::spawn(move || {
                    responder.respond(native_stream::handle_request(state, request));
                });
            }
        )
        .invoke_handler(tauri::generate_handler![
            check_signed_update_now,
            credentials::save_saved_session,
            credentials::read_saved_session,
            credentials::forget_saved_session,
            native_stream::create_native_stream_ticket,
            native_stream::stop_native_stream_ticket,
            native_stream::stop_all_native_streams,
        ])
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
            // Keep the QA window distinguishable from installed Stable/Preview.
            .title(app.config().product_name.clone().unwrap_or_else(
                || "Vynéo".into()))
            .inner_size(1280.0, 800.0)
            .min_inner_size(860.0, 560.0)
            .visible(!cfg!(feature="native-e2e-qa"))
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

            // QA smoke is a hidden throwaway process: never add a tray icon
            // or expose a second app surface to the user's live desktop.
            if !cfg!(feature="native-e2e-qa") {
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
            }
            if !cfg!(feature="native-e2e-qa") {
                let handle=app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _=check_signed_update(handle).await;
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Impossible de démarrer Vynéo");
}
