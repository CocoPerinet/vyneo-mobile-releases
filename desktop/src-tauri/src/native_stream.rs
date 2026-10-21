// Experimental direct MP4 playback, deliberately separate from the signed
// updater and the OS credential vault. No Jellyfin bearer token is ever
// embedded in an HTML media URL or sent to an arbitrary remote host.
use std::{
    collections::HashMap,
    io::Read,
    sync::{atomic::{AtomicUsize, Ordering}, Arc, Mutex},
    time::{Duration, Instant},
};
use serde::Serialize;
use tauri::{
    http::{header, Method, Request, Response, StatusCode},
    State,
};

const JELLYFIN_ORIGIN: &str = "https://cocojellyfin.duckdns.org:38443";
const CHUNK: u64 = 2 * 1024 * 1024;
const MAX_PARALLEL: usize = 8;
const TICKET_LIFETIME: Duration = Duration::from_secs(4 * 60 * 60);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum StreamKind { DirectMp4, Hls }

#[derive(Clone)]
pub(crate) struct StreamGrant {
    pub(crate) item: String,
    pub(crate) source: String,
    pub(crate) token: String,
    pub(crate) device: String,
    pub(crate) kind: StreamKind,
    pub(crate) negotiated_hls: Option<reqwest::Url>,
    pub(crate) assets: Arc<Mutex<HashMap<String, reqwest::Url>>>,
    pub(crate) expires: Instant,
}

pub struct Tickets {
    pub(crate) grants: Mutex<HashMap<String, StreamGrant>>,
    pub(crate) active: AtomicUsize,
    pub(crate) client: reqwest::blocking::Client,
}

impl Tickets {
    pub fn new() -> Result<Self, reqwest::Error> {
        let client = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(30))
            .build()?;
        Ok(Self { grants: Mutex::new(HashMap::new()),
            active: AtomicUsize::new(0), client })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeStreamTicket {
    ticket: String,
    url: String,
}

fn guid(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}
pub(crate) fn valid_guid(value: &str) -> bool { guid(value) }
fn safe_device(value: &str) -> bool {
    (5..=80).contains(&value.len()) &&
        value.bytes().all(|byte| byte.is_ascii_alphanumeric()
            || byte == b'-' || byte == b'_')
}
fn safe_token(value: &str) -> bool {
    (12..=2048).contains(&value.len()) &&
        value.bytes().all(|byte| byte.is_ascii_alphanumeric()
            || byte == b'-' || byte == b'_' || byte == b'.')
}

#[tauri::command]
pub fn create_native_stream_ticket(
    state: State<'_, Arc<Tickets>>,
    item_id: String,
    media_source_id: String,
    user_id: String,
    access_token: String,
    device_id: String,
    kind: String,
    hls_path: Option<String>,
) -> Result<NativeStreamTicket, String> {
    if !guid(&item_id) || !guid(&media_source_id) || !guid(&user_id)
        || !safe_token(&access_token) || !safe_device(&device_id)
    {
        return Err("STREAM_SCOPE_INVALID".into());
    }
    let stream_kind = match kind.as_str() {
        "direct" => StreamKind::DirectMp4,
        "hls" => StreamKind::Hls,
        _ => return Err("STREAM_KIND_INVALID".into()),
    };
    let negotiated_hls=if stream_kind==StreamKind::Hls {
        let path=hls_path.as_deref()
            .ok_or_else(|| "STREAM_HLS_URL_INVALID".to_string())?;
        Some(crate::native_hls::validated_playlist_url(
            &item_id,&media_source_id,path
        ).ok_or_else(|| "STREAM_HLS_URL_INVALID".to_string())?)
    }else{
        if hls_path.is_some(){return Err("STREAM_HLS_SCOPE_INVALID".into());}
        None
    };
    let key = uuid::Uuid::new_v4().simple().to_string();
    let grant = StreamGrant {
        item: item_id, source: media_source_id,
        token: access_token, device: device_id, kind: stream_kind,
        negotiated_hls,
        assets: Arc::new(Mutex::new(HashMap::new())),
        expires: Instant::now() + TICKET_LIFETIME,
    };
    let mut map = state.grants.lock().map_err(|_| "STREAM_STATE_ERROR")?;
    map.retain(|_, existing| existing.expires > Instant::now());
    // Never retain a series of abandoned sessions in memory.
    if map.len() >= 2 {
        return Err("STREAM_SESSION_LIMIT".into());
    }
    map.insert(key.clone(), grant);
    #[cfg(target_os = "windows")]
    let prefix = "http://vyneo-media.localhost/stream/";
    #[cfg(not(target_os = "windows"))]
    let prefix = "vyneo-media://localhost/stream/";
    let url = match stream_kind {
        StreamKind::DirectMp4 => format!("{prefix}{key}"),
        StreamKind::Hls => {
            #[cfg(target_os = "windows")]
            let prefix = "http://vyneo-media.localhost/hls/";
            #[cfg(not(target_os = "windows"))]
            let prefix = "vyneo-media://localhost/hls/";
            format!("{prefix}{key}/index.m3u8")
        }
    };
    Ok(NativeStreamTicket { url, ticket: key })
}

#[tauri::command]
pub fn stop_native_stream_ticket(
    state: State<'_, Arc<Tickets>>, ticket: String, app: tauri::AppHandle
) {
    #[cfg(not(feature="native-e2e-qa"))]
    let _ = &app;
    #[cfg(feature="native-e2e-qa")]
    let mut quit_qa=false;
    if guid(&ticket) {
        if let Ok(mut map) = state.grants.lock() {
            #[cfg(feature="native-e2e-qa")]
            {
                quit_qa=map.get(&ticket)
                    .is_some_and(crate::native_e2e_qa::is_fixture);
            }
            map.remove(&ticket);
        }
    }
    // Only the separately identified QA binary may auto-exit.
    // The installed stable must never quit on an ordinary media stop.
    #[cfg(feature="native-e2e-qa")]
    if quit_qa { app.exit(0); }
}

#[tauri::command]
pub fn stop_all_native_streams(state: State<'_, Arc<Tickets>>) {
    if let Ok(mut map) = state.grants.lock() {
        map.clear();
    }
}

struct RequestLimit(Arc<Tickets>);
impl Drop for RequestLimit {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::SeqCst);
    }
}

fn limited_range(header: Option<&str>) -> Result<String, ()> {
    let Some(value) = header else {
        return Ok(format!("bytes=0-{}", CHUNK - 1));
    };
    let rest = value.strip_prefix("bytes=").ok_or(())?;
    if rest.contains(',') { return Err(()); }
    let (start, end) = rest.split_once('-').ok_or(())?;
    if start.is_empty() {
        let count = end.parse::<u64>().map_err(|_| ())?;
        if count == 0 { return Err(()); }
        return Ok(format!("bytes=-{}", count.min(CHUNK)));
    }
    let offset = start.parse::<u64>().map_err(|_| ())?;
    let maximum = offset.saturating_add(CHUNK - 1);
    let end = if end.is_empty() { maximum } else {
        let requested = end.parse::<u64>().map_err(|_| ())?;
        if requested < offset { return Err(()); }
        requested.min(maximum)
    };
    Ok(format!("bytes={offset}-{end}"))
}

fn plain_status(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Vec::new())
        .expect("static status response")
}

fn safe_header_value(value: &reqwest::header::HeaderValue) -> Option<String> {
    value.to_str().ok().map(ToOwned::to_owned)
}
fn accepted_video_content_type(value: &str) -> bool {
    matches!(value.split(';').next().unwrap_or("").trim().to_ascii_lowercase().as_str(),
        "video/mp4" | "video/x-m4v" | "application/octet-stream" | "")
}

fn media_request(state: Arc<Tickets>, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.uri().path().starts_with("/hls/") {
        return crate::native_hls::handle_request(state, request);
    }
    let origin = request.headers().get(header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    if origin.is_some() && origin != Some("http://tauri.localhost")
        && origin != Some("tauri://localhost")
    {
        return plain_status(StatusCode::FORBIDDEN);
    }
    let path = request.uri().path();
    if request.uri().query().is_some() ||
       !path.starts_with("/stream/") ||
       !guid(&path["/stream/".len()..])
    {
        return plain_status(StatusCode::NOT_FOUND);
    }
    let key = &path["/stream/".len()..];
    let grant = match state.grants.lock() {
        Ok(mut map) => {
            map.retain(|_, entry| entry.expires > Instant::now());
            map.get(key).cloned()
        }
        Err(_) => return plain_status(StatusCode::INTERNAL_SERVER_ERROR),
    };
    let Some(grant) = grant else {
        return plain_status(StatusCode::NOT_FOUND);
    };
    if grant.kind != StreamKind::DirectMp4 {
        return plain_status(StatusCode::NOT_FOUND);
    }
    if request.method() == Method::OPTIONS {
        return Response::builder().status(StatusCode::NO_CONTENT)
            .header("access-control-allow-origin", "http://tauri.localhost")
            .header("access-control-allow-methods", "GET, HEAD, OPTIONS")
            .header("access-control-allow-headers", "range")
            .header(header::CACHE_CONTROL, "no-store")
            .body(Vec::new()).expect("static preflight");
    }
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return plain_status(StatusCode::METHOD_NOT_ALLOWED);
    }
    let range = match limited_range(request.headers().get(header::RANGE)
        .and_then(|value| value.to_str().ok()))
    {
        Ok(range) => range,
        Err(_) => return plain_status(StatusCode::RANGE_NOT_SATISFIABLE),
    };
    let active = state.active.fetch_add(1, Ordering::SeqCst);
    if active >= MAX_PARALLEL {
        state.active.fetch_sub(1, Ordering::SeqCst);
        return plain_status(StatusCode::TOO_MANY_REQUESTS);
    }
    let _guard = RequestLimit(state.clone());
    // The ONLY network destination is the pinned user's Jellyfin server.
    // Redirects are disabled, so a STRM redirect can never carry credentials
    // to a third-party host. The media-source ID is an independently checked GUID.
    let url = format!(
        "{JELLYFIN_ORIGIN}/Videos/{}/stream.mp4?Static=true&MediaSourceId={}",
        grant.item, grant.source
    );
    let auth = format!(
        "MediaBrowser Client=\"Vyneo\", Device=\"Desktop\", DeviceId=\"{}\", Version=\"{}\", Token=\"{}\"",
        grant.device, env!("CARGO_PKG_VERSION"), grant.token
    );
    let method_is_head = request.method() == Method::HEAD;
    let call = if method_is_head {
        state.client.head(url).header(header::AUTHORIZATION, auth)
    } else {
        state.client.get(url).header(header::AUTHORIZATION, auth)
            .header(header::RANGE, range)
    };
    let mut upstream = match call.send() {
        Ok(response) => response,
        Err(_) => return plain_status(StatusCode::BAD_GATEWAY),
    };
    let code = upstream.status().as_u16();
    if code == 401 || code == 403 {
        return plain_status(StatusCode::FORBIDDEN);
    }
    if code == 416 { return plain_status(StatusCode::RANGE_NOT_SATISFIABLE); }
    if code != 200 && code != 206 {
        return plain_status(StatusCode::BAD_GATEWAY);
    }
    // A reverse-proxy login page or a JSON error served with HTTP 200
    // must never masquerade as an HTML5 video resource.
    if !accepted_video_content_type(upstream.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok()).unwrap_or(""))
    {
        return plain_status(StatusCode::BAD_GATEWAY);
    }
    let total = upstream.headers().get(reqwest::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    let range_result = upstream.headers().get(reqwest::header::CONTENT_RANGE)
        .and_then(safe_header_value);
    if !method_is_head && (
        (code == 206 && range_result.is_none()) ||
        (code == 200 && total.is_some_and(|size| size > CHUNK))
    ) {
        return plain_status(StatusCode::BAD_GATEWAY);
    }
    let content = if method_is_head {
        Vec::new()
    } else {
        let mut data = Vec::with_capacity(CHUNK as usize);
        if upstream.take(CHUNK + 1).read_to_end(&mut data).is_err()
            || data.is_empty() || data.len() as u64 > CHUNK
        {
            return plain_status(StatusCode::BAD_GATEWAY);
        }
        data
    };
    let mut builder = Response::builder()
        .status(StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_GATEWAY))
        .header(header::CONTENT_TYPE, "video/mp4")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::ACCEPT_RANGES, "bytes")
        .header("cross-origin-resource-policy", "cross-origin")
        .header("access-control-allow-origin", "http://tauri.localhost");
    if let Some(value) = range_result {
        builder = builder.header(header::CONTENT_RANGE, value);
    }
    // For HEAD preserve the upstream size; for GET send the actual bounded
    // byte count. Never promise a Content-Length inconsistent with the body.
    if method_is_head {
        if let Some(size) = total {
            builder = builder.header(header::CONTENT_LENGTH, size.to_string());
        }
    } else {
        builder = builder.header(header::CONTENT_LENGTH, content.len().to_string());
    }
    builder.body(content).unwrap_or_else(|_| plain_status(StatusCode::BAD_GATEWAY))
}

pub fn handle_request(state: Arc<Tickets>, request: Request<Vec<u8>>)
    -> Response<Vec<u8>>
{
    media_request(state, request)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn safe_scope_and_headers() {
        assert!(guid(&"a".repeat(32)));
        assert!(!guid("../../etc/passwd"));
        assert!(!safe_token("bad\r\nAuthorization: spoof"));
        assert!(safe_device("vyneo-desktop-1"));
        assert!(!safe_device("desktop;evil"));
    }
    #[test]
    fn bounded_single_range() {
        assert_eq!(limited_range(None).unwrap(),
            "bytes=0-2097151");
        assert_eq!(limited_range(Some("bytes=100-")).unwrap(),
            "bytes=100-2097251");
        assert_eq!(limited_range(Some("bytes=5-20")).unwrap(),
            "bytes=5-20");
        assert_eq!(limited_range(Some("bytes=-99999999")).unwrap(),
            "bytes=-2097152");
        for bad in ["bytes=0-1,3-4","bytes=9-0","other=0-",
                    "bytes=-0","bytes=a-b","bytes=0-NaN"] {
            assert!(limited_range(Some(bad)).is_err());
        }
    }
    #[test]
    fn never_accept_html_or_json_disguised_as_video() {
        for mime in ["application/json","text/html; charset=utf-8",
                     "application/vnd.apple.mpegurl","text/plain"] {
            assert!(!accepted_video_content_type(mime));
        }
        assert!(accepted_video_content_type("video/mp4; charset=binary"));
        assert!(accepted_video_content_type("application/octet-stream"));
    }
    #[test]
    fn unknown_capability_never_uses_network() {
        let tickets = Arc::new(Tickets::new().unwrap());
        let request = Request::builder()
            .uri("http://vyneo-media.localhost/stream/deadbeef")
            .body(Vec::new()).unwrap();
        assert_eq!(handle_request(tickets.clone(), request).status(),
            StatusCode::NOT_FOUND);
        assert_eq!(tickets.active.load(Ordering::SeqCst), 0);
    }
}
