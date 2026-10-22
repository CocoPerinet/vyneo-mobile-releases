/** A hidden, portable Tauri/WebView2 HLS codec smoke test.
 * Uses a compile-time QA-only local fixture, a separate app identifier
 * and zero real Jellyfin credentials. Builds no installer and never
 * touches the installed Vynéo application or user-focused Windows.
 */
import {createServer} from "node:http";
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {spawn,execFile} from "node:child_process";
import {promisify} from "node:util";
import {randomBytes} from "node:crypto";
import assert from "node:assert/strict";

const desktop=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const source=join(desktop,"qa","native-webview2");
const assets=join(desktop,"qa-native-dist");
const exe=join(desktop,"src-tauri","target","debug","vyneo-desktop.exe");
const nonce=randomBytes(16).toString("hex");
const execFileAsync=promisify(execFile);
let server=null,taskRegistered=false;
const taskName="VyneoNativeMediaQA"+nonce.slice(0,12);
const psQuote=value=>"'"+value.replaceAll("'","''")+"'";
async function taskPowerShell(command){
  return execFileAsync("powershell.exe",[
    "-NoProfile","-NonInteractive","-Command",command
  ],{windowsHide:true,timeout:12000,maxBuffer:100000});
}
async function cleanupOrphanedQaTasks(){
  // A remote SSH session may drop while the hidden QA is running.
  // Recover only tasks whose action is this exact disposable QA binary.
  // Never touch the installed stable process or unrelated scheduled tasks.
  const script=[
    "$ErrorActionPreference='Stop';",
    "$exe=",psQuote(exe)+";",
    "$tasks=@(Get-ScheduledTask -TaskName 'VyneoNativeMediaQA*'",
    "-ErrorAction SilentlyContinue | Where-Object {",
    "$_.Actions.Count -eq 1 -and $_.Actions[0].Execute -eq $exe });",
    "foreach($task in $tasks){",
    "Stop-ScheduledTask -TaskName $task.TaskName",
    "-ErrorAction SilentlyContinue;",
    "Unregister-ScheduledTask -TaskName $task.TaskName -Confirm:$false",
    "-ErrorAction Stop; }"
  ].join(" ");
  await taskPowerShell(script);
}
async function startInteractiveQa(){
  await cleanupOrphanedQaTasks();
  const create=([
    "$ErrorActionPreference='Stop';",
    "$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit",
    "(New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew;",
    "$principal=New-ScheduledTaskPrincipal -UserId",
    "([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited;",
    "$action=New-ScheduledTaskAction -Execute",psQuote(exe)+";",
    "Register-ScheduledTask -TaskName",psQuote(taskName),
    "-Action $action -Principal $principal -Settings $settings",
    "-Force | Out-Null;",
    "Start-ScheduledTask -TaskName",psQuote(taskName)
  ]).join(" ");
  taskRegistered=true;
  await taskPowerShell(create);
}
async function stopInteractiveQa(){
  if(!taskRegistered)return;
  taskRegistered=false;
  const remove=([
    "$ErrorActionPreference='Stop';",
    "$task=Get-ScheduledTask -TaskName",psQuote(taskName),
    "-ErrorAction SilentlyContinue;",
    "if($null -ne $task){",
    "Stop-ScheduledTask -TaskName",psQuote(taskName),
    "-ErrorAction SilentlyContinue;",
    "Unregister-ScheduledTask -TaskName",psQuote(taskName),
    "-Confirm:$false; }"
  ]).join(" ");
  await taskPowerShell(remove);
}
const maxBuildMs=420000,maxPlaybackMs=26000;
let reportResolve,reportReject;
const reportPromise=new Promise((yes,no)=>{reportResolve=yes;reportReject=no;});

function headersFor(origin){
  if(origin && origin!=="http://tauri.localhost" &&
      origin!=="tauri://localhost")
    return null;
  return {"Access-Control-Allow-Origin":origin??"http://tauri.localhost",
    "Access-Control-Allow-Headers":"content-type",
    "Access-Control-Allow-Methods":"OPTIONS,POST",
    "Access-Control-Allow-Private-Network":"true",
    "Cache-Control":"no-store","Vary":"Origin"};
}
function collect(body,chunk,maxBytes=20000){
  const n=body.reduce((sum,part)=>sum+part.length,0);
  if(n+chunk.length>maxBytes)throw Error("QA_RESULT_TOO_LARGE");
  body.push(chunk);
}
async function build(){
  console.log("QA_NATIVE_WEBVIEW2_BUILD_ISOLATED_NO_BUNDLE");
  const args=["/d","/s","/c",
    "npm run tauri -- build --debug --no-bundle --features native-e2e-qa --config src-tauri/tauri.jellyfin-qa.conf.json"];
  const process=spawn("cmd.exe",args,{
    cwd:desktop,windowsHide:true,stdio:["ignore","pipe","pipe"]
  });
  let tail="";
  for(const pipe of [process.stdout,process.stderr]){
    pipe.on("data",chunk=>{
      tail=(tail+String(chunk)).slice(-8500);
    });
  }
  let timer;
  const timed=new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      process.kill();
      reject(new Error("QA_COMPILATION_TIMEOUT"));
    },maxBuildMs);
  });
  try{
    const exit=await Promise.race([
      new Promise((resolve,reject)=>{
        process.once("error",reject);
        process.once("exit",(code)=>resolve(code));
      }),timed
    ]);
    assert.equal(exit,0,"QA_BUILD_FAILED: "+tail.slice(-2200));
    assert(existsSync(exe),"QA_DEBUG_BINARY_MISSING");
    console.log("QA_NATIVE_WEBVIEW2_COMPILED_NO_INSTALLER");
  }finally{clearTimeout(timer);}
}
async function main(){
  if(process.platform!=="win32")
    throw Error("QA_ONLY_ON_WINDOWS_DESKTOP");
  let received=0;
  server=createServer((req,res)=>{
    const origin=req.headers.origin;
    const hdr=headersFor(origin);
    if(!hdr){
      res.writeHead(403);res.end();return;
    }
    const path=new URL(req.url??"/","http://127.0.0.1").pathname;
    if(path!=="/native-webview2-report/"+nonce){
      res.writeHead(404,hdr);res.end();return;
    }
    if(req.method==="OPTIONS"){
      res.writeHead(204,hdr);res.end();return;
    }
    if(req.method!=="POST"){
      res.writeHead(405,hdr);res.end();return;
    }
    let body=[];
    req.on("data",chunk=>{
      try{collect(body,chunk);}
      catch(error){reportReject(error);req.destroy();}
    });
    req.on("end",()=>{
      try{
        if(received++!==0)throw Error("DUPLICATE_QA_REPORT");
        const result=JSON.parse(Buffer.concat(body).toString("utf8"));
        if(!result || result.outcome!=="PASS")
          throw Error("WEBVIEW2_NATIVE_HLS_FAILED: "+JSON.stringify(result));
        const m=result.metrics;
        assert.equal(m.nativeProtocol,true);
        assert.equal(m.width,320);
        assert.equal(m.height,180);
        assert(m.currentTime>=3.7&&m.currentTime<=6.2);
        assert(m.readyState>=2);
        assert(m.decodedFrames>=m.framesBeforeSeek+3);
        assert.equal(m.paused,false);
        assert.equal(m.pauseVerified,true);
        assert.equal(m.seekVerified,true);
        assert.equal(m.seekTargetSeconds,3.2);
        assert.equal(m.hlsWorkerConfigured,true);
        assert.equal(m.updaterQaGuarded,true,
          "QA native updater must reject before any update network/install");
        assert.equal(m.audioContextState,"running");
        assert.equal(m.audioUnmuted,true);
        assert(m.audioAnalyserSamples>=3,
          "WebView2 must deliver samples to the audio analyzer");
        assert(m.audioRmsPeak>=0.008,
          "WebView2 must decode non-silent AAC PCM without speaker output");
        assert.deepEqual(result.errors,[]);
        res.writeHead(204,hdr);res.end();
        reportResolve(result);
      }catch(error){
        res.writeHead(400,hdr);res.end();
        reportReject(error);
      }
    });
  });
  await new Promise((done,fail)=>{
    server.once("error",fail);
    server.listen(0,"127.0.0.1",done);
  });
  const port=server.address().port;
  mkdirSync(assets,{recursive:true});
  const html=readFileSync(join(source,"index.template.html"),"utf8")
    .replaceAll("%%QA_PORT%%",String(port));
  const script=readFileSync(join(source,"test.template.js"),"utf8")
    .replaceAll("%%QA_PORT%%",String(port))
    .replaceAll("%%QA_NONCE%%",nonce);
  writeFileSync(join(assets,"index.html"),html);
  writeFileSync(join(assets,"test.js"),script);
  copyFileSync(
    join(desktop,"node_modules","hls.js","dist","hls.min.js"),
    join(assets,"hls.min.js")
  );
  await build();
  console.log("QA_NATIVE_WEBVIEW2_LAUNCHING_HIDDEN_IN_INTERACTIVE_SESSION");
  // SSH runs in Windows Session 0 and cannot create a WebView2 HWND.
  // An InteractiveToken scheduled task runs in the already logged-in
  // desktop session, without focus, tray icon or app installation.
  await startInteractiveQa();
  let timer;
  try{
    const timeout=new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error(
        "QA_NATIVE_WEBVIEW2_DECODING_TIMEOUT_INTERACTIVE_SESSION")),maxPlaybackMs);
    });
    const result=await Promise.race([reportPromise,timeout]);
    console.log("VYNEO_WEBVIEW2_NATIVE_VIDEO_AND_AAC_AUDIO_PASS",
      JSON.stringify(result.metrics));
    console.log("QA_ZERO_INSTALLER_ZERO_REAL_CREDENTIALS");
  }finally{clearTimeout(timer);}
}
try{
  await main();
}catch(error){
  console.error("VYNEO_WEBVIEW2_NATIVE_QA_FAILED",error?.message||String(error));
  process.exitCode=1;
}finally{
  try{await stopInteractiveQa();}
  catch(error){console.error("QA_SCHEDULED_TASK_CLEANUP_FAILED",String(error));}
  if(server)await new Promise(done=>server.close(done));
}
