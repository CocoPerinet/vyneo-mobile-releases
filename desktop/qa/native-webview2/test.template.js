/* In-memory synthetic QA media, not deployed in any stable Vynéo build. */
(async()=>{
"use strict";
const port="%%QA_PORT%%";
const secret="%%QA_NONCE%%";
const reportURL="http://127.0.0.1:"+port+"/native-webview2-report/"+secret;
let sent=false;
const video=document.getElementById("video");
let hls;
const fatal=[];
async function report(outcome,metrics={}){
  if(sent)return;
  sent=true;
  try{
    await fetch(reportURL,{
      method:"POST",mode:"cors",credentials:"omit",cache:"no-store",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({outcome,metrics,errors:fatal.slice(0,6)})
    });
  }catch{/* Runner timeout reports connectivity errors separately. */}
}
const die=why=>{fatal.push(String(why).slice(0,180));void report("FAIL",{});};
try{
  const invoke=window.__TAURI_INTERNALS__?.invoke;
  if(typeof invoke!=="function")throw Error("TAURI_INTERNALS_UNAVAILABLE");
  if(!window.Hls?.isSupported())throw Error("MSE_HLS_UNAVAILABLE");
  const itemId="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const sourceId="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const hlsPath="/Videos/"+itemId+"/master.m3u8?MediaSourceId="+sourceId+
    "&VideoCodec=h264&AudioCodec=aac&SegmentContainer=ts"+
    "&PlaySessionId=cccccccccccccccccccccccccccccccc";
  const ticket=await invoke("create_native_stream_ticket",{
    itemId,mediaSourceId:sourceId,
    userId:"dddddddddddddddddddddddddddddddd",
    accessToken:"qa-local-only-never-real-jellyfin-token",
    deviceId:"qa-webview2-desktop",
    kind:"hls",hlsPath
  });
  if(!ticket || !ticket.url?.startsWith("http://vyneo-media.localhost/hls/") ||
    !/^[0-9a-f]{32}$/.test(ticket.ticket))
    throw Error("BAD_NATIVE_CAPABILITY");
  hls=new window.Hls({
    enableWorker:false,maxBufferLength:12,maxMaxBufferLength:24,
    manifestLoadingMaxRetry:0,levelLoadingMaxRetry:0,
    fragLoadingMaxRetry:0
  });
  hls.on(window.Hls.Events.ERROR,(_event,detail)=>{
    if(detail.fatal)die(detail.type+":"+detail.details);
  });
  hls.on(window.Hls.Events.MEDIA_ATTACHED,()=>{
    hls.loadSource(ticket.url);
  });
  hls.on(window.Hls.Events.MANIFEST_PARSED,()=>{
    void video.play().catch(error=>die("PLAY_DENIED:"+error));
  });
  hls.attachMedia(video);
  const interval=setInterval(async()=>{
    if(sent){clearInterval(interval);return;}
    const decoded=video.getVideoPlaybackQuality?.().totalVideoFrames??0;
    if(video.videoWidth!==320 || video.videoHeight!==180 ||
      video.readyState<2 || video.currentTime<0.6 ||
      video.paused || decoded<8)return;
    clearInterval(interval);
    const metrics={
      width:video.videoWidth,height:video.videoHeight,
      readyState:video.readyState,decodedFrames:decoded,
      currentTime:Math.round(video.currentTime*100)/100,
      duration:Math.round(video.duration*100)/100,
      paused:video.paused,
      nativeProtocol:true,
      drm:false
    };
    await invoke("stop_native_stream_ticket",{ticket:ticket.ticket});
    await report("PASS",metrics);
  },130);
  setTimeout(()=>{
    clearInterval(interval);
    if(!sent)die("NO_DECODED_WEBVIEW2_FRAME_TIMEOUT");
  },18000);
}catch(e){die(e?.message||String(e));}
})();
