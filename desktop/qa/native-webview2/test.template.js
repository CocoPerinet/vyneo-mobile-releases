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
  // The manual updater command must exist in native Tauri but must never
  // check a feed or install software in the isolated QA executable.
  let updaterGuarded=false;
  try{
    await invoke("check_signed_update_now");
  }catch(error){
    updaterGuarded=String(error).includes("UPDATE_DISABLED_IN_QA");
  }
  if(!updaterGuarded)throw Error("NATIVE_UPDATER_QA_ISOLATION_FAILED");
  const itemId="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const sourceId="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const hlsPath="/Videos/"+itemId+"/master.m3u8?MediaSourceId="+sourceId+
    "&VideoCodec=h264&AudioCodec=aac&SegmentContainer=ts"+
    "&PlaySessionId=cccccccccccccccccccccccccccccccc";
  // Observe decoded PCM from the real WebView2 media pipeline. A zero-gain
  // sink prevents any audio reaching the user's speakers during hidden QA.
  // This does not claim an audible user-session test.
  const context=new window.AudioContext();
  const audioSource=context.createMediaElementSource(video);
  const analyser=context.createAnalyser();
  analyser.fftSize=2048;
  const zeroGain=context.createGain();
  zeroGain.gain.value=0;
  audioSource.connect(analyser);
  analyser.connect(zeroGain);
  zeroGain.connect(context.destination);
  const samples=new Float32Array(analyser.fftSize);
  let audioPeakRms=0,audioSamplesRead=0,audioUnmuted=false;
  void context.resume().catch(()=>{});
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
    // Match the production WebView2/hls.js worker + buffering path.
    enableWorker:true,maxBufferLength:24,
    maxMaxBufferLength:48,maxBufferSize:48*1024*1024,
    manifestLoadingMaxRetry:2,levelLoadingMaxRetry:2,
    fragLoadingMaxRetry:2
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
  let stage="initial",framesBeforeSeek=0,pausedBeforeSeek=false;
  const interval=setInterval(async()=>{
    if(sent){clearInterval(interval);return;}
    const decoded=video.getVideoPlaybackQuality?.().totalVideoFrames??0;
    if(!audioUnmuted && context.state==="running" &&
      !video.paused && video.currentTime>=0.2){
      // The MediaElementAudioSource replaces direct playback audio.
      // Its only connection to the system sink has gain=0.
      video.muted=false;
      audioUnmuted=true;
    }
    if(context.state==="running"){
      analyser.getFloatTimeDomainData(samples);
      let energy=0;
      for(const value of samples)energy+=value*value;
      audioPeakRms=Math.max(audioPeakRms,
        Math.sqrt(energy/samples.length));
      audioSamplesRead++;
    }
    if(video.videoWidth!==320 || video.videoHeight!==180 ||
      video.readyState<2 || video.paused || decoded<8)return;
    if(stage==="initial"){
      if(video.currentTime<0.6)return;
      framesBeforeSeek=decoded;
      video.pause();
      pausedBeforeSeek=video.paused;
      if(!pausedBeforeSeek || video.seekable.length===0){
        die("PLAYER_PAUSE_OR_SEEK_UNAVAILABLE");return;
      }
      stage="seeking";
      try{video.currentTime=3.2;}
      catch(error){die("PLAYER_SEEK_FAILED:"+error);return;}
      void video.play().catch(error=>die("RESUME_DENIED:"+error));
      return;
    }
    if(stage!=="seeking" || video.currentTime<3.7 ||
      decoded<framesBeforeSeek+3)return;
    stage="reported";
    clearInterval(interval);
    const metrics={
      width:video.videoWidth,height:video.videoHeight,
      readyState:video.readyState,decodedFrames:decoded,
      framesBeforeSeek,currentTime:Math.round(video.currentTime*100)/100,
      duration:Math.round(video.duration*100)/100,
      paused:video.paused,
      pauseVerified:pausedBeforeSeek,
      seekVerified:true,
      seekTargetSeconds:3.2,
      hlsWorkerConfigured:true,
      updaterQaGuarded:updaterGuarded,
      nativeProtocol:true,
      drm:false,
      audioContextState:context.state,
      audioAnalyserSamples:audioSamplesRead,
      audioUnmuted,
      audioRmsPeak:Number(audioPeakRms.toFixed(6))
    };
    await report("PASS",metrics);
    // The QA-specific native command revokes the ticket and exits the
    // hidden throwaway process. It cannot affect the installed Vynéo.
    void invoke("stop_native_stream_ticket",{ticket:ticket.ticket})
      .catch(()=>{});
  },130);
  setTimeout(()=>{
    clearInterval(interval);
    if(!sent)die("NO_DECODED_WEBVIEW2_FRAME_TIMEOUT");
  },18000);
}catch(e){die(e?.message||String(e));}
})();
