// QA-only native scheme fixture. This module is completely absent from
// production builds (no native-e2e-qa Cargo feature) and cannot access
// Jellyfin credentials or the user's library. No network request is sent.
use std::{sync::Arc,time::Instant};
use tauri::http::{header,Request,Response,StatusCode};
use crate::native_stream::{StreamGrant,StreamKind};

pub(crate) const ITEM:&str="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
pub(crate) const SOURCE:&str="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
pub(crate) const TOKEN:&str="qa-local-only-never-real-jellyfin-token";

pub(crate) fn is_fixture(grant:&StreamGrant)->bool{
    grant.item==ITEM && grant.source==SOURCE
        && grant.token==TOKEN
        && grant.kind==StreamKind::Hls
        && grant.expires>Instant::now()
}
fn reply(payload:Vec<u8>,mime:&str,origin:&str)->Response<Vec<u8>>{
    Response::builder().status(StatusCode::OK)
        .header(header::CONTENT_TYPE,mime)
        .header(header::CACHE_CONTROL,"no-store")
        .header(header::CONTENT_LENGTH,payload.len().to_string())
        .header("access-control-allow-origin",origin)
        .header("access-control-expose-headers","content-length,content-type")
        .body(payload).expect("QA reply")
}
fn rejected()->Response<Vec<u8>>{
    Response::builder().status(StatusCode::NOT_FOUND)
        .header(header::CACHE_CONTROL,"no-store")
        .body(Vec::new()).expect("QA rejected")
}
pub(crate) fn serve(
    request:&Request<Vec<u8>>,grant:&StreamGrant,ticket:&str,origin:&str
)->Response<Vec<u8>>{
    if !is_fixture(grant) {return rejected();}
    let last=request.uri().path().rsplit('/').next().unwrap_or("");
    let Some(master)=grant.negotiated_hls.as_ref() else{return rejected();};
    if last=="index.m3u8"{
        let playlist=concat!(
            "#EXTM3U\n#EXT-X-VERSION:3\n",
            "#EXT-X-STREAM-INF:BANDWIDTH=450000,CODECS=\"avc1.42c01e,mp4a.40.2\",RESOLUTION=320x180\n",
            "hls1/main/playlist.m3u8\n"
        );
        return crate::native_hls::rewrite_playlist(
            playlist,master,grant,ticket
        ).map(|s|reply(s.into_bytes(),"application/vnd.apple.mpegurl",origin))
            .unwrap_or_else(|_|rejected());
    }
    let url=match grant.assets.lock(){
        Ok(map)=>map.get(last).cloned(),
        Err(_)=>None
    };
    let Some(url)=url else{return rejected();};
    match url.path().rsplit('/').next().unwrap_or("") {
        "playlist.m3u8"=>{
            let playlist=include_str!("../../qa/fixtures/hls/playlist.m3u8");
            crate::native_hls::rewrite_playlist(
                playlist,&url,grant,ticket
            ).map(|s|reply(s.into_bytes(),"application/vnd.apple.mpegurl",origin))
                .unwrap_or_else(|_|rejected())
        }
        "segment000.ts" =>reply(include_bytes!(
            "../../qa/fixtures/hls/segment000.ts").to_vec(),"video/mp2t",origin),
        "segment001.ts" =>reply(include_bytes!(
            "../../qa/fixtures/hls/segment001.ts").to_vec(),"video/mp2t",origin),
        "segment002.ts" =>reply(include_bytes!(
            "../../qa/fixtures/hls/segment002.ts").to_vec(),"video/mp2t",origin),
        _=>rejected()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;
    use std::time::Duration;
    fn demo()->StreamGrant{
        StreamGrant {
            item:ITEM.into(),source:SOURCE.into(),token:TOKEN.into(),
            device:"qa-device".into(),kind:StreamKind::Hls,
            negotiated_hls:crate::native_hls::validated_playlist_url(
                ITEM,SOURCE,&format!(
                    "/Videos/{ITEM}/master.m3u8?MediaSourceId={SOURCE}&VideoCodec=h264&AudioCodec=aac&SegmentContainer=ts"
                )).into(),
            assets:Arc::new(Mutex::new(HashMap::new())),
            expires:Instant::now()+Duration::from_secs(60)
        }
    }
    #[test]
    fn synthetic_master_media_and_three_segments_stay_scoped(){
        let ticket="f".repeat(32);
        let grant=demo();
        let create=|asset:&str|Request::builder().uri(format!(
            "http://vyneo-media.localhost/hls/{ticket}/{asset}"
        )).body(Vec::new()).unwrap();
        let master=serve(&create("index.m3u8"),&grant,&ticket,"http://tauri.localhost");
        assert_eq!(master.status(),StatusCode::OK);
        let text=String::from_utf8(master.into_body()).unwrap();
        assert!(text.starts_with("#EXTM3U"));
        assert!(!text.contains("/Videos/"));
        assert!(!text.contains(TOKEN));
        let child=grant.assets.lock().unwrap().keys().next().unwrap().clone();
        let manifest=serve(&create(&child),&grant,&ticket,"http://tauri.localhost");
        assert_eq!(manifest.status(),StatusCode::OK);
        let body=String::from_utf8(manifest.into_body()).unwrap();
        assert!(body.contains("#EXT-X-ENDLIST"));
        assert!(!body.contains("segment000.ts"));
        assert_eq!(grant.assets.lock().unwrap().len(),4);
        for index in 0..3 {
            let target=format!("segment00{index}.ts");
            let key=grant.assets.lock().unwrap().iter()
                .find(|(_,v)|v.path().ends_with(&target)).unwrap().0.clone();
            let segment=serve(&create(&key),&grant,&ticket,"http://tauri.localhost");
            assert_eq!(segment.status(),StatusCode::OK);
            assert!(segment.body().len()>50_000);
        }
        assert_eq!(serve(&create("00000000000000000000000000000000"),
            &grant,&ticket,"http://tauri.localhost").status(),StatusCode::NOT_FOUND);
        assert_eq!(serve(&create("index.m3u8"),&StreamGrant {
            token:"not-the-qa-token".into(),..grant
        },&ticket,"http://tauri.localhost").status(),StatusCode::NOT_FOUND);
    }
}
