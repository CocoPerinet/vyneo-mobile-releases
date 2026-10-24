#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// A candidate allowed to access the real Jellyfin API must never be bundled
// as a release, installed in place, or share the stable application's identity.
#[cfg(all(feature="interactive-jellyfin-qa", not(debug_assertions)))]
compile_error!("Interactive Jellyfin QA is restricted to unsigned debug builds");

mod quality_policy;
mod credentials;
mod native_stream;
mod native_hls;
#[cfg(feature="native-e2e-qa")]
mod native_e2e_qa;

use std::time::{Duration, Instant};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    menu::MenuBuilder,
    tray::TrayIconBuilder,
    webview::WebviewWindowBuilder,
    Manager, WebviewUrl, WindowEvent,
};
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

const INTERACTIVE_QA_IDENTIFIER: &str = "fr.visyren.vyneo.desktop.authqa";
fn interactive_qa() -> bool { cfg!(feature="interactive-jellyfin-qa") }
const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(10);
const UPDATE_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(180);
const AUTOMATIC_UPDATE_INTERVAL: Duration = Duration::from_secs(6*60*60);
static LAST_AUTO_UPDATE_CHECK: Mutex<Option<Instant>> = Mutex::new(None);

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
    if cfg!(feature="native-e2e-qa") || interactive_qa() { return Err("UPDATE_DISABLED_IN_QA"); }
    let permit=UpdatePermit::claim().ok_or("UPDATE_BUSY")?;
    check_signed_update_with_permit(app,permit).await
}

// The automatic caller reserves the same permit before consuming its
// six-hour slot. It must not claim a check happened when one was busy.
async fn check_signed_update_with_permit(
    app: tauri::AppHandle,
    _permit: UpdatePermit,
) -> Result<&'static str,&'static str> {
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

// Only check on an intentional (re)opening of Vynéo, not on window focus
// events, video playback, or an app that stays minimized all day.
fn update_recheck_due(last: Option<Instant>, now: Instant) -> bool {
    last.map_or(true,|at|now.saturating_duration_since(at)>=AUTOMATIC_UPDATE_INTERVAL)
}
fn reserve_automatic_update_check(
    last: &mut Option<Instant>,
    now: Instant,
) -> Option<UpdatePermit> {
    if !update_recheck_due(*last,now) { return None; }
    let permit=UpdatePermit::claim()?;
    *last=Some(now);
    Some(permit)
}
fn schedule_update_if_due(app: tauri::AppHandle) {
    if cfg!(feature="native-e2e-qa") || interactive_qa() { return; }
    let Ok(mut last)=LAST_AUTO_UPDATE_CHECK.lock() else { return; };
    let Some(permit)=reserve_automatic_update_check(&mut last,Instant::now())
        else { return; };
    drop(last);
    tauri::async_runtime::spawn(async move {
        let _=check_signed_update_with_permit(app,permit).await;
    });
}

#[tauri::command]
fn is_temporary_qa() -> bool { interactive_qa() }

#[tauri::command]
async fn check_signed_update_now(
    app: tauri::AppHandle,
) -> Result<&'static str,String> {
    check_signed_update(app).await.map_err(str::to_owned)
}

#[cfg(test)]
mod update_tests {
    use super::*;
    #[test]
    fn permit_rejects_concurrent_checks_and_releases_on_drop() {
        let permit=UpdatePermit::claim().expect("first check must claim lock");
        assert!(UpdatePermit::claim().is_none());
        drop(permit);
        assert!(UpdatePermit::claim().is_some());
        assert!(!UPDATE_RUNNING.load(Ordering::Acquire));

        // A manual check in flight must NOT consume the automatic 6h slot.
        let now=Instant::now();
        let mut last=None;
        let manual=UpdatePermit::claim().expect("manual update owns permit");
        assert!(reserve_automatic_update_check(&mut last,now).is_none());
        assert_eq!(last,None);
        drop(manual);

        // The next real opening may check immediately, but not twice.
        let automatic=reserve_automatic_update_check(&mut last,now)
            .expect("automatic check starts after manual check");
        assert_eq!(last,Some(now));
        assert!(UpdatePermit::claim().is_none());
        drop(automatic);
        assert!(reserve_automatic_update_check(
            &mut last,now+Duration::from_secs(60)).is_none());
        assert!(reserve_automatic_update_check(
            &mut last,now+AUTOMATIC_UPDATE_INTERVAL).is_some());
        assert!(!UPDATE_RUNNING.load(Ordering::Acquire));
    }

    #[test]
    fn auto_recheck_only_after_six_hours_of_inactive_window() {
        let now=Instant::now();
        assert!(update_recheck_due(None,now));
        assert!(!update_recheck_due(Some(now),now));
        assert!(!update_recheck_due(Some(now-Duration::from_secs(60)),now));
        assert!(!update_recheck_due(Some(now-
            Duration::from_secs(6*60*60-1)),now));
        assert!(update_recheck_due(Some(now-AUTOMATIC_UPDATE_INTERVAL),now));
        assert!(update_recheck_due(Some(now-
            Duration::from_secs(24*60*60)),now));
        // A future monotonic clock timestamp must not permit an early check.
        assert!(!update_recheck_due(Some(now+Duration::from_secs(5)),now));
    }
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
            is_temporary_qa,
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
            schedule_update_if_due((*app).clone());
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Fail closed: the QA feature and distinct runtime identity must
            // always travel together. The stable identifier is never reused.
            if interactive_qa() !=
                (app.config().identifier == INTERACTIVE_QA_IDENTIFIER) {
                return Err("INTERACTIVE_QA_IDENTITY_MISMATCH".into());
            }
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
                    // A portable QA has no tray; closing its window must end
                    // the test rather than leaving an invisible process.
                    if interactive_qa() { return; }
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
            if !cfg!(feature="native-e2e-qa") && !interactive_qa() {
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
                            schedule_update_if_due((*app).clone());
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .build(app)?;
            }
            }
            schedule_update_if_due(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Impossible de démarrer Vynéo");
}
