/**
 * A real decoding check of hls.js + H.264/AAC MPEG-TS on Chromium.
 * No Jellyfin credentials, no playback writes, no installed second app.
 * Unlike unit tests, this waits for decoded HTMLVideoElement frames.
 * NOT proof of WebView2-native Tauri or a .strm user's Jellyfin session.
 */
import {chromium} from "playwright-core";
import {createServer} from "node:http";
import {readFileSync,existsSync,mkdirSync} from "node:fs";
import {resolve,join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";

const desktop=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const fixtures=join(desktop,"qa","fixtures","hls");
const hlsScript=join(desktop,"node_modules","hls.js","dist","hls.min.js");
const shots=resolve(desktop,"..","qa-shots");
const ticket="a".repeat(32);
const seen=[];
assert(existsSync(hlsScript),"Pinned local hls.js must be installed");
const manifest=readFileSync(join(fixtures,"playlist.m3u8"),"utf8");
assert(manifest.startsWith("#EXTM3U"));
assert(!/https?:|ApiKey|access_token/i.test(manifest));
let http;
let browser;
try{
  http=createServer((req,res)=>{
    const path=new URL(req.url??"/","http://127.0.0.1").pathname;
    seen.push(path);
    const headers={"Cache-Control":"no-store","Access-Control-Allow-Origin":"*"};
    let contents;
    if(path==="/"){
      contents=Buffer.from('<!doctype html><html lang="en"><title>Native HLS codec smoke</title><body style="background:#111"><video id="video" playsinline muted controls width="640" height="360"></video></body></html>');
      headers["Content-Type"]="text/html";
    }else if(path==="/hls/"+ticket+"/index.m3u8"){
      contents=Buffer.from("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=450000,CODECS=\"avc1.42c01e,mp4a.40.2\",RESOLUTION=320x180\n/hls/"+ticket+"/playlist.m3u8\n");
      headers["Content-Type"]="application/vnd.apple.mpegurl";
    }else if(path==="/hls/"+ticket+"/playlist.m3u8"){
      contents=Buffer.from(manifest.replace(/^segment(\d+)\.ts$/gm,
        "/hls/"+ticket+"/segment$1.ts"));
      headers["Content-Type"]="application/vnd.apple.mpegurl";
    }else if(new RegExp("^/hls/"+ticket+"/segment00[0-2]\\.ts$").test(path)){
      contents=readFileSync(join(fixtures,path.split("/").at(-1)));
      headers["Content-Type"]="video/mp2t";
    }else{
      res.writeHead(404,headers);res.end();return;
    }
    headers["Content-Length"]=String(contents.length);
    res.writeHead(200,headers);res.end(contents);
  });
  await new Promise((done,reject)=>{
    http.once("error",reject);
    http.listen(0,"127.0.0.1",done);
  });
  const port=http.address().port;
  browser=await chromium.launch({
    executablePath:process.env.CHROME_PATH||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless:true,
    args:["--no-first-run","--autoplay-policy=no-user-gesture-required"]
  });
  const page=await browser.newPage({viewport:{width:820,height:600}});
  const errors=[];
  page.on("pageerror",err=>errors.push(String(err).slice(0,400)));
  await page.goto("http://127.0.0.1:"+port);
  await page.addScriptTag({path:hlsScript});
  const supported=await page.evaluate(()=>window.Hls.isSupported());
  assert(supported,"Chromium must expose HTML5 MediaSource H.264");
  await page.evaluate(ticket=>{
    const video=document.getElementById("video");
    const hls=new window.Hls({
      enableWorker:true,maxBufferLength:12,maxMaxBufferLength:24,
      manifestLoadingMaxRetry:0,levelLoadingMaxRetry:0,
      fragLoadingMaxRetry:0
    });
    window.qaPlayer=hls;
    window.qaErrors=[];
    hls.on(window.Hls.Events.ERROR,(_e,err)=>{
      window.qaErrors.push({
        type:err.type,
        details:err.details,
        fatal:err.fatal
      });
    });
    hls.on(window.Hls.Events.MEDIA_ATTACHED,()=>
      hls.loadSource("/hls/"+ticket+"/index.m3u8"));
    hls.on(window.Hls.Events.MANIFEST_PARSED,()=>
      video.play().catch(err=>window.qaErrors.push({
        type:"autoplay",details:String(err),fatal:true
      })));
    hls.attachMedia(video);
  },ticket);
  await page.waitForFunction(()=>{
    const v=document.getElementById("video");
    return v.videoWidth===320 && v.videoHeight===180 &&
      v.currentTime>=0.75 && !v.paused;
  },null,{timeout:18000});
  const metrics=await page.evaluate(()=>{
    const v=document.getElementById("video");
    const frames=v.getVideoPlaybackQuality?.();
    return {
      width:v.videoWidth,height:v.videoHeight,
      duration:Math.round(v.duration*100)/100,
      currentTime:Math.round(v.currentTime*100)/100,
      readyState:v.readyState,paused:v.paused,
      totalFrames:frames?.totalVideoFrames??null,
      fatalErrors:window.qaErrors.filter(err=>err.fatal)
    };
  });
  assert.equal(metrics.width,320);
  assert(metrics.currentTime>=0.75 && metrics.readyState>=2);
  if(metrics.totalFrames!==null)
    assert(metrics.totalFrames>0,"Decoded frame count must be positive");
  assert.equal(errors.length,0,JSON.stringify(errors));
  assert.equal(metrics.fatalErrors.length,0,JSON.stringify(metrics.fatalErrors));
  assert(seen.includes("/hls/"+ticket+"/index.m3u8"));
  assert(seen.includes("/hls/"+ticket+"/playlist.m3u8"));
  assert(seen.some(path=>path.endsWith(".ts")));
  assert(seen.every(path=>path==="/"||
    path.startsWith("/hls/"+ticket+"/")));
  mkdirSync(shots,{recursive:true});
  await page.locator("#video").screenshot({
    path:join(shots,"hls-codec-smoke-first-frame.png")
  });
  console.log("VYNEO_HLS_CHROMIUM_FIRST_FRAME_PASS",JSON.stringify(metrics));
  console.log("VYNEO_HLS_FIXTURE_SEGMENTS_REQUESTED",
    seen.filter(path=>path.endsWith(".ts")).length);
}finally{
  await browser?.close();
  if(http)await new Promise(done=>http.close(done));
}
