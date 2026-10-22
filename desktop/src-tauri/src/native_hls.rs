// Server-side HLS transcoding for Jellyfin .strm videos. This is a Tauri
// protocol handler, NOT an HTTP server listening on any network interface.
// Upstream playlist URLs stay in Rust memory; the renderer sees only random
// capability IDs under the custom vyneo-media scheme.
use std::{
    collections::HashMap,
    io::Read,
    sync::{atomic::Ordering, Arc},
    time::Instant,
};
use tauri::http::{header, Method, Request, Response, StatusCode};
use crate::native_stream::{StreamGrant, StreamKind, Tickets};

const UPSTREAM: &str = "https://cocojellyfin.duckdns.org:38443";
const MAX_PLAYLIST: usize = 512 * 1024;
const MAX_SEGMENT: usize = 16 * 1024 * 1024;
const MAX_ASSETS: usize = 4096;
const PARALLEL_REQUESTS: usize = 8;

struct Busy(Arc<Tickets>);
impl Drop for Busy {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::SeqCst);
    }
}

fn bad(code: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(code)
        .header(header::CACHE_CONTROL, "no-store")
        .body(Vec::new()).expect("fixed error response")
}

// Give trusted Tauri callers the actual HTTP status on failed HLS requests.
// Earlier, missing CORS headers disguised native 4xx/5xx as ERR_FAILED.
// Only the non-distributable interactive QA reveals bounded reason codes.
fn fail_to_trusted_origin(
    status: StatusCode, origin: &str, reason: &'static str
) -> Response<Vec<u8>> {
    let reply=Response::builder().status(status)
        .header(header::CACHE_CONTROL,"no-store")
        .header("access-control-allow-origin",origin)
        .header("access-control-expose-headers","x-vyneo-qa-hls-reason");
    #[cfg(feature="interactive-jellyfin-qa")]
    let reply=reply.header("x-vyneo-qa-hls-reason",reason);
    #[cfg(not(feature="interactive-jellyfin-qa"))]
    let _=reason;
    reply.body(Vec::new()).expect("fixed trusted-origin failure")
}

fn acceptable_origin(request: &Request<Vec<u8>>) -> Option<&str> {
    match request.headers().get(header::ORIGIN) {
        None => Some("http://tauri.localhost"),
        Some(value) if value.as_bytes() == b"http://tauri.localhost"
            => Some("http://tauri.localhost"),
        Some(value) if value.as_bytes() == b"tauri://localhost"
            => Some("tauri://localhost"),
        _ => None,
    }
}

fn private_base(item: &str) -> Result<reqwest::Url, ()> {
    reqwest::Url::parse(&format!("{UPSTREAM}/Videos/{item}/main.m3u8"))
        .map_err(|_| ())
}

/** The Jellyfin POST /PlaybackInfo chooses the codecs, session and
 * stream-specific parameters. Never guess the transcode URL locally: use
 * only its vetted, token-free master playlist with the pinned origin. */
pub(crate) fn validated_playlist_url(
    item: &str, source: &str, path: &str
) -> Option<reqwest::Url> {
    if path.len()>5000 || !path.starts_with('/') || path.starts_with("//")
        || path.contains('#') || path.contains('\\')
        || path.chars().any(|c| c.is_control())
    { return None; }
    let url=reqwest::Url::parse(UPSTREAM).ok()?.join(path).ok()?;
    if url.scheme()!="https"
        || url.host_str()!=Some("cocojellyfin.duckdns.org")
        || url.port_or_known_default()!=Some(38443)
        || !url.username().is_empty() || url.password().is_some()
    { return None; }
    let parts=url.path().split('/').collect::<Vec<_>>();
    if parts.len()!=4 || !parts[0].is_empty()
        || !parts[1].eq_ignore_ascii_case("videos")
        || !parts[3].eq_ignore_ascii_case("master.m3u8")
        || parts[2].replace('-',"").to_ascii_lowercase()
            !=item.to_ascii_lowercase()
    { return None; }
    let mut source_matched=false;
    let mut video_matched=false;
    let mut audio_matched=false;
    let mut container_matched=false;
    let mut count=0usize;
    for (key,value) in url.query_pairs() {
        count+=1;
        if count>70 || key.len()>64 || value.len()>384
            || !key.bytes().all(|b| b.is_ascii_alphanumeric()
                || b==b'_' || b==b'-')
            || value.chars().any(|c|c.is_control())
        { return None; }
        let normalized=key.to_ascii_lowercase()
            .replace('-',"").replace('_',"");
        if normalized.contains("token") || normalized.contains("apikey")
            || normalized.contains("secret") || normalized.contains("password")
            || normalized.contains("authorization")
            || normalized.contains("credential") || normalized.contains("bearer")
        { return None; }
        match normalized.as_str() {
            "mediasourceid" =>
                source_matched=value.replace('-',"").eq_ignore_ascii_case(source),
            "videocodec" =>video_matched=value.eq_ignore_ascii_case("h264"),
            "audiocodec" =>audio_matched=value.split(',')
                .any(|v|v.eq_ignore_ascii_case("aac")),
            "segmentcontainer" =>container_matched=value.eq_ignore_ascii_case("ts"),
            _=>{}
        }
    }
    if !(source_matched && video_matched && audio_matched && container_matched){
        return None;
    }
    Some(url)
}

fn index_url(grant: &StreamGrant) -> Result<reqwest::Url, ()> {
    grant.negotiated_hls.clone().ok_or(())
}

fn sanitized_upstream(
    base: &reqwest::Url, reference: &str, item: &str
) -> Result<reqwest::Url, &'static str> {
    // These codes are static and safe. They contain neither a URL, item ID
    // nor credentials. Only the debug interactive QA exposes them to WebView2.
    if reference.is_empty() || reference.chars().any(|c| c.is_control()) {
        return Err("HLS_ASSET_INVALID_REFERENCE");
    }
    let mut url = base.join(reference).map_err(|_| "HLS_ASSET_URL_PARSE")?;
    if url.scheme() != "https" { return Err("HLS_ASSET_SCHEME"); }
    if url.host_str() != Some("cocojellyfin.duckdns.org") {
        return Err("HLS_ASSET_HOST");
    }
    if url.port_or_known_default() != Some(38443) {
        return Err("HLS_ASSET_PORT");
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("HLS_ASSET_CREDENTIALS");
    }
    if url.fragment().is_some() { return Err("HLS_ASSET_FRAGMENT"); }
    let prefix = format!("/videos/{item}/").to_ascii_lowercase();
    let lower_path=url.path().to_ascii_lowercase();
    if !lower_path.starts_with(&prefix) {
        // Do not surface paths, GUIDs, stream URLs or original references.
        // Classify ONLY their route family in this never-released QA build.
        let parts=lower_path.split('/').filter(|x|!x.is_empty())
            .take(2).collect::<Vec<_>>();
        let reason=match parts.as_slice() {
            ["videos", id] if *id == item.to_ascii_lowercase() =>
                "HLS_ASSET_VIDEO_ROOT",
            ["videos", _] => "HLS_ASSET_OTHER_VIDEO_ID",
            ["audio", _] => "HLS_ASSET_AUDIO_ROUTE",
            ["hls", _] => "HLS_ASSET_HLS_ROUTE",
            ["items", _] => "HLS_ASSET_ITEMS_ROUTE",
            _ if lower_path.contains(&item.to_ascii_lowercase()) =>
                "HLS_ASSET_UNEXPECTED_ITEM_ROUTE",
            _ => "HLS_ASSET_OTHER_ROUTE",
        };
        return Err(reason);
    }
    // Some Jellyfin HLS manifests include a token in every segment URL.
    // Drop that token and authorize upstream ONLY with the private header.
    let params = url.query_pairs()
        .filter(|(name, _)| {
            !matches!(name.to_ascii_lowercase().as_str(),
                "apikey" | "api_key" | "access_token" | "x-emby-token")
        })
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect::<Vec<_>>();
    url.set_query(None);
    if !params.is_empty() {
        url.query_pairs_mut().extend_pairs(params);
    }
    Ok(url)
}

#[cfg(target_os = "windows")]
fn asset_local_url(ticket: &str, id: &str) -> String {
    format!("http://vyneo-media.localhost/hls/{ticket}/{id}")
}
#[cfg(not(target_os = "windows"))]
fn asset_local_url(ticket: &str, id: &str) -> String {
    format!("vyneo-media://localhost/hls/{ticket}/{id}")
}

pub(crate) fn rewrite_playlist(
    manifest: &str, base: &reqwest::Url, grant: &StreamGrant,
    ticket: &str
) -> Result<String, &'static str> {
    if manifest.len() > MAX_PLAYLIST
        || !manifest.trim_start().starts_with("#EXTM3U")
    {
        return Err("HLS_INVALID_MANIFEST");
    }
    let original = grant.assets.lock().map_err(|_| "HLS_ASSET_STATE")?.clone();
    let mut pending: HashMap<String, reqwest::Url> = HashMap::new();
    let replace = |reference: &str,
                   pending: &mut HashMap<String, reqwest::Url>|
        -> Result<String, &'static str> {
        let target = sanitized_upstream(base, reference, &grant.item)?;
        let existing = original.iter().chain(pending.iter())
            .find(|(_, url)| **url == target)
            .map(|(id, _)| id.clone());
        let key = if let Some(id) = existing { id } else {
            if original.len()+pending.len() >= MAX_ASSETS {
                return Err("HLS_ASSET_LIMIT");
            }
            let id = uuid::Uuid::new_v4().simple().to_string();
            pending.insert(id.clone(), target);
            id
        };
        Ok(asset_local_url(ticket, &key))
    };
    let mut output=String::with_capacity(manifest.len()*2);
    for line in manifest.lines() {
        let line=line.trim_end_matches('\r');
        if line.starts_with("#EXT-X-BYTERANGE:")
            || (line.starts_with("#EXT-X-MAP:") && line.contains("BYTERANGE="))
        {
            // Our HLS asset proxy serves entire segments. Do not silently
            // hand MSE the wrong bytes for a byte-range-only playlist.
            return Err("HLS_UNSUPPORTED_BYTERANGE");
        }
        if line.starts_with("#EXT-X-KEY:")
            && !line.contains("METHOD=NONE") {
            // AES-128 / DRM playlists need an explicit key model.
            return Err("HLS_ENCRYPTION_UNSUPPORTED");
        }
        if line.starts_with("#EXT-X-SESSION-KEY:") {
            return Err("HLS_ENCRYPTION_UNSUPPORTED");
        }
        if line.starts_with('#') && line.contains("URI=\"") {
            let mut rest = line;
            let mut replaced = String::new();
            while let Some(pos) = rest.find("URI=\"") {
                let prefix_end = pos+"URI=\"".len();
                replaced.push_str(&rest[..prefix_end]);
                let trailing = &rest[prefix_end..];
                let quote = trailing.find('"').ok_or("HLS_URI_QUOTE")?;
                replaced.push_str(&replace(&trailing[..quote], &mut pending)?);
                replaced.push('"');
                rest = &trailing[quote+1..];
            }
            replaced.push_str(rest);
            output.push_str(&replaced);
        } else if !line.starts_with('#') && !line.trim().is_empty() {
            output.push_str(&replace(line.trim(), &mut pending)?);
        } else {
            output.push_str(line);
        }
        output.push('\n');
    }
    // Reject unexpected token-bearing HLS extension tags as well.
    // Only synthetic, ticket-scoped local asset URLs can reach the renderer.
    let lower=output.to_ascii_lowercase();
    if lower.contains("api_key") || lower.contains("apikey")
        || lower.contains("access_token")
        || lower.contains("cocojellyfin.duckdns.org")
    {
        return Err("HLS_SENSITIVE_MANIFEST");
    }
    // Commit capabilities only after *every* URI passed the same-origin,
    // same-item and scheme checks. An invalid manifest grants nothing.
    let mut map = grant.assets.lock().map_err(|_| "HLS_ASSET_STATE")?;
    if map.len()+pending.len() > MAX_ASSETS { return Err("HLS_ASSET_LIMIT"); }
    map.extend(pending);
    Ok(output)
}

fn media_type(url: &reqwest::Url, ct: &str) -> Result<bool, ()> {
    let mime = ct.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    let playlist = url.path().to_ascii_lowercase().ends_with(".m3u8")
        || matches!(mime.as_str(),
            "application/vnd.apple.mpegurl"|"application/x-mpegurl"
            |"audio/mpegurl"|"audio/x-mpegurl");
    if playlist {
        if !matches!(mime.as_str(),
            ""|"application/vnd.apple.mpegurl"|"application/x-mpegurl"
            |"audio/mpegurl"|"audio/x-mpegurl"|"text/plain"
            |"application/octet-stream") { return Err(()); }
        return Ok(true);
    }
    if !matches!(mime.as_str(),
        ""|"video/mp2t"|"video/mp4"|"audio/mp4"|"video/iso.segment"
        |"audio/aac"|"application/octet-stream") {
        return Err(());
    }
    Ok(false)
}

pub fn handle_request(
    state: Arc<Tickets>, request: Request<Vec<u8>>
) -> Response<Vec<u8>> {
    let Some(origin) = acceptable_origin(&request) else {
        return bad(StatusCode::FORBIDDEN);
    };
    let fail=|status:StatusCode,reason:&'static str|
        fail_to_trusted_origin(status,origin,reason);
    if request.uri().query().is_some() {
        return fail(StatusCode::NOT_FOUND,"HLS_NOT_FOUND");
    }
    let path=request.uri().path();
    let chunks=path.split('/').collect::<Vec<_>>();
    if chunks.len()!=4 || chunks[1]!="hls" ||
        !super::native_stream::valid_guid(chunks[2]) {
        return fail(StatusCode::NOT_FOUND,"HLS_NOT_FOUND");
    }
    let key=chunks[2];
    let grant=match state.grants.lock() {
        Ok(mut grants)=>{
            grants.retain(|_, g|g.expires>Instant::now());
            grants.get(key).cloned()
        },
        Err(_)=>return fail(StatusCode::INTERNAL_SERVER_ERROR,"HLS_INTERNAL_SERVER_ERROR"),
    };
    let Some(grant)=grant else {
        return fail(StatusCode::NOT_FOUND,"HLS_NOT_FOUND");
    };
    if grant.kind!=StreamKind::Hls {
        return fail(StatusCode::NOT_FOUND,"HLS_NOT_FOUND");
    }
    if request.method()==Method::OPTIONS {
        return Response::builder().status(StatusCode::NO_CONTENT)
            .header("access-control-allow-origin",origin)
            .header("access-control-allow-methods","GET, OPTIONS")
            .header("access-control-allow-headers","range")
            .header(header::CACHE_CONTROL,"no-store")
            .body(Vec::new()).expect("static cors");
    }
    if request.method()!=Method::GET {
        return fail(StatusCode::METHOD_NOT_ALLOWED,"HLS_METHOD_NOT_ALLOWED");
    }
    // No QA test data/code reaches a stable release binary.
    #[cfg(feature="native-e2e-qa")]
    if crate::native_e2e_qa::is_fixture(&grant) {
        return crate::native_e2e_qa::serve(&request,&grant,key,origin);
    }
    let url=if chunks[3]=="index.m3u8" {
        match index_url(&grant) {
            Ok(url)=>url,Err(_)=>return fail(StatusCode::BAD_REQUEST,"HLS_BAD_REQUEST")
        }
    } else {
        if !super::native_stream::valid_guid(chunks[3]) {
            return fail(StatusCode::NOT_FOUND,"HLS_NOT_FOUND");
        }
        match grant.assets.lock() {
            Ok(map)=>match map.get(chunks[3]) {
                Some(url)=>url.clone(),
                None=>return fail(StatusCode::NOT_FOUND,"HLS_NOT_FOUND")
            },
            Err(_)=>return fail(StatusCode::INTERNAL_SERVER_ERROR,"HLS_INTERNAL_SERVER_ERROR"),
        }
    };
    let already=state.active.fetch_add(1,Ordering::SeqCst);
    if already>=PARALLEL_REQUESTS {
        state.active.fetch_sub(1,Ordering::SeqCst);
        return fail(StatusCode::TOO_MANY_REQUESTS,"HLS_TOO_MANY_REQUESTS");
    }
    let _busy=Busy(state.clone());
    let auth=format!(
        "MediaBrowser Client=\"Vyneo\", Device=\"Desktop\", DeviceId=\"{}\", Version=\"{}\", Token=\"{}\"",
        grant.device,env!("CARGO_PKG_VERSION"),grant.token
    );
    let mut upstream=match state.client.get(url.clone())
        .header(header::AUTHORIZATION,auth).send() {
        Ok(response)=>response,
        Err(_)=>return fail(StatusCode::BAD_GATEWAY,"HLS_UPSTREAM_NETWORK"),
    };
    let code=upstream.status().as_u16();
    if code==401 || code==403 {
        return fail(StatusCode::FORBIDDEN,"HLS_FORBIDDEN");
    }
    if code!=200 && code!=206 {
        return fail(StatusCode::BAD_GATEWAY,"HLS_UPSTREAM_HTTP_STATUS");
    }
    let content_type=upstream.headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value|value.to_str().ok()).unwrap_or("").to_string();
    let is_playlist=match media_type(&url,&content_type) {
        Ok(v)=>v,
        Err(_)=>return fail(StatusCode::BAD_GATEWAY,"HLS_UPSTREAM_MEDIA_TYPE"),
    };
    let cap=if is_playlist { MAX_PLAYLIST } else { MAX_SEGMENT };
    if upstream.content_length().is_some_and(|size|size>cap as u64) {
        return fail(StatusCode::BAD_GATEWAY,"HLS_UPSTREAM_OVERSIZE");
    }
    let mut data=Vec::new();
    if upstream.take(cap as u64+1).read_to_end(&mut data).is_err()
        || data.is_empty() || data.len()>cap {
        return fail(StatusCode::BAD_GATEWAY,"HLS_UPSTREAM_BODY");
    }
    let (body,mime)=if is_playlist {
        let manifest=match std::str::from_utf8(&data) {
            Ok(text)=>text,Err(_)=>return fail(StatusCode::BAD_GATEWAY,"HLS_MANIFEST_ENCODING")
        };
        let rewritten=match rewrite_playlist(manifest,&url,&grant,key) {
            Ok(text)=>text,Err(reason)=>return fail(StatusCode::BAD_GATEWAY,reason)
        };
        (rewritten.into_bytes(),"application/vnd.apple.mpegurl")
    } else {
        let kind=if content_type.is_empty() {
            if url.path().ends_with(".mp4") {"video/mp4"} else {"video/mp2t"}
        } else {
            content_type.split(';').next().unwrap_or("video/mp2t")
        };
        return Response::builder().status(StatusCode::OK)
            .header(header::CONTENT_TYPE,kind)
            .header(header::CONTENT_LENGTH,data.len().to_string())
            .header(header::CACHE_CONTROL,"no-store")
            .header("access-control-allow-origin",origin)
            .header("access-control-expose-headers","content-length,content-type")
            .body(data).unwrap_or_else(|_|fail(StatusCode::BAD_GATEWAY,"HLS_RESPONSE_BUILD"));
    };
    Response::builder().status(StatusCode::OK)
        .header(header::CONTENT_TYPE,mime)
        .header(header::CONTENT_LENGTH,body.len().to_string())
        .header(header::CACHE_CONTROL,"no-store")
        .header("access-control-allow-origin",origin)
        .header("access-control-expose-headers","content-length,content-type")
        .body(body).unwrap_or_else(|_|fail(StatusCode::BAD_GATEWAY,"HLS_RESPONSE_BUILD"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::time::Duration;
    #[test]
    fn trusted_origin_gets_cors_even_on_failure_but_foreign_origin_does_not() {
        let state=Arc::new(Tickets::new().expect("bounded HTTP client"));
        let request=|origin:&str|Request::builder()
            .uri(format!("http://vyneo-media.localhost/hls/{}/index.m3u8",
                "f".repeat(32)))
            .header(header::ORIGIN,origin).body(Vec::new()).unwrap();
        let trusted=handle_request(state.clone(),request("http://tauri.localhost"));
        assert_eq!(trusted.status(),StatusCode::NOT_FOUND);
        assert_eq!(trusted.headers().get("access-control-allow-origin")
            .unwrap(),"http://tauri.localhost");
        #[cfg(feature="interactive-jellyfin-qa")]
        assert_eq!(trusted.headers().get("x-vyneo-qa-hls-reason")
            .unwrap(),"HLS_NOT_FOUND");
        #[cfg(not(feature="interactive-jellyfin-qa"))]
        assert!(trusted.headers().get("x-vyneo-qa-hls-reason").is_none());
        let foreign=handle_request(state,request("https://evil.example"));
        assert_eq!(foreign.status(),StatusCode::FORBIDDEN);
        assert!(foreign.headers().get("access-control-allow-origin").is_none());
        assert!(foreign.headers().get("x-vyneo-qa-hls-reason").is_none());
    }
    fn fixture() -> StreamGrant {
        StreamGrant {
            item:"a".repeat(32),source:"b".repeat(32),
            token:"c".repeat(52),device:"desktop-test".into(),
            kind:StreamKind::Hls,
            negotiated_hls:Some(validated_playlist_url(
                &"a".repeat(32),&"b".repeat(32),
                &format!("/Videos/{}/master.m3u8?MediaSourceId={}&VideoCodec=h264&AudioCodec=aac&SegmentContainer=ts&PlaySessionId={}&Tag=fixture",
                    "a".repeat(32),"b".repeat(32),"c".repeat(32))
            ).unwrap()),
            assets:Arc::new(Mutex::new(HashMap::new())),
            expires:Instant::now()+Duration::from_secs(120)
        }
    }
    #[test]
    fn profile_negotiated_playlist_is_pinned_and_not_rediscovered() {
        let item="a".repeat(32);
        let source="b".repeat(32);
        let canonical=format!(
            "/Videos/{}/master.m3u8?MediaSourceId={}&VideoCodec=h264&AudioCodec=aac&SegmentContainer=ts&PlaySessionId={}&Tag=sample",
            item,source,"c".repeat(32));
        let url=validated_playlist_url(&item,&source,&canonical).unwrap();
        assert_eq!(url.as_str(),
            format!("{UPSTREAM}{canonical}").as_str());
        assert_eq!(index_url(&fixture()).unwrap()
            .query_pairs().find(|(k,_)|k=="Tag").unwrap().1,"fixture");
        for invalid in [
            format!("https://evil.example{canonical}"),
            canonical.replace("master.m3u8","main.m3u8"),
            canonical.replace(&source,&"d".repeat(32)),
            canonical.replace("VideoCodec=h264","VideoCodec=hevc"),
            canonical.replace("AudioCodec=aac","AudioCodec=ac3"),
            canonical.replace("SegmentContainer=ts","SegmentContainer=mp4"),
            format!("{canonical}&ApiKey=SECRET"),
            format!("{canonical}&Authorization=SECRET"),
            format!("{canonical}#fragment"),
            format!("/Videos/{}/master.m3u8?MediaSourceId={}&VideoCodec=h264",
                "f".repeat(32),source)
        ] {
            assert!(validated_playlist_url(&item,&source,&invalid).is_none());
        }
    }
    #[test]
    fn never_allow_cross_domain_or_cross_item_assets() {
        let base=private_base(&"a".repeat(32)).unwrap();
        for raw in ["https://evil.example/test.mp4",
            "http://cocojellyfin.duckdns.org:38443/anything",
            "https://cocojellyfin.duckdns.org:38443/admin/users",
            "https://cocojellyfin.duckdns.org:38443/Videos/cccc/clip.ts",
            "//evil.example/video.ts","file:///etc/passwd"] {
            assert!(sanitized_upstream(&base,raw,&"a".repeat(32)).is_err());
        }
        // Preserve the established fixed destination, port, and item scope.
        let guarded=[
            ("https://evil.example/test.mp4","HLS_ASSET_HOST"),
            ("http://cocojellyfin.duckdns.org:38443/Videos/",
                "HLS_ASSET_SCHEME"),
            ("https://cocojellyfin.duckdns.org:443/Videos/",
                "HLS_ASSET_PORT"),
            ("https://cocojellyfin.duckdns.org:38443/Admin/Users",
                "HLS_ASSET_OTHER_ROUTE"),
            ("https://cocojellyfin.duckdns.org:38443/Audio/x/hls1/main/0.ts",
                "HLS_ASSET_AUDIO_ROUTE"),
            ("https://cocojellyfin.duckdns.org:38443/Hls/any/main.m3u8",
                "HLS_ASSET_HLS_ROUTE"),
            ("https://cocojellyfin.duckdns.org:38443/Videos/cccccccccccccccccccccccccccccccc/hls1/main/0.ts",
                "HLS_ASSET_OTHER_VIDEO_ID")
        ];
        for (reference,reason) in guarded {
            assert_eq!(sanitized_upstream(&base,reference,&"a".repeat(32)),
                Err(reason));
        }
        let url=sanitized_upstream(
            &base,
            "hls1/main/1.mp4?MediaSourceId=s&api_key=SECRET&ApiKey=SECRET2",
            &"a".repeat(32)).unwrap();
        assert!(url.as_str().contains("MediaSourceId=s"));
        assert!(!url.as_str().contains("SECRET"));
    }
    #[test]
    fn manifest_rewrite_removes_all_upstream_urls_and_tokens() {
        let grant=fixture();
        let base=private_base(&grant.item).unwrap();
        let source="#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-MAP:URI=\"init.mp4?api_key=SECRET\"\n#EXTINF:6.0,\nhls1/main/0.mp4?api_key=SECRET\n";
        let text=rewrite_playlist(source,&base,&grant,&"d".repeat(32)).unwrap();
        assert!(text.contains("#EXT-X-MAP:URI=\"http://vyneo-media.localhost/hls/")
            || text.contains("#EXT-X-MAP:URI=\"vyneo-media://localhost/hls/"));
        assert!(!text.contains("api_key"));
        assert!(!text.contains("SECRET"));
        assert_eq!(grant.assets.lock().unwrap().len(),2);
    }
    #[test]
    fn manifests_fail_closed_on_redirect_and_encryption() {
        let grant=fixture();
        let base=private_base(&grant.item).unwrap();
        for input in [
            "#EXTM3U\nhttps://evil.example/0.ts\n",
            "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key\"\n",
            "#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=AES-128,URI=\"key\"\n",
            "#EXTM3U\n#EXT-X-BYTERANGE:100@0\nhls1/main/0.mp4\n",
            "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\",BYTERANGE=\"100@0\"\n",
            "<html>login</html>"
        ] {
            assert!(rewrite_playlist(input,&base,&grant,&"d".repeat(32)).is_err());
            assert!(grant.assets.lock().unwrap().is_empty());
        }
    }
    #[test]
    fn mime_rejects_html_and_json_transcoded_errors() {
        let base=private_base(&"a".repeat(32)).unwrap();
        assert_eq!(media_type(&base,"application/vnd.apple.mpegurl"),Ok(true));
        assert!(media_type(&base,"text/html").is_err());
        let segment=base.join("hls1/main/0.mp4").unwrap();
        assert_eq!(media_type(&segment,"video/mp4"),Ok(false));
        assert!(media_type(&segment,"application/json").is_err());
    }
}
