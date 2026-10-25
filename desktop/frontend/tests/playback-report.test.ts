import {describe,it,expect,vi} from "vitest";
import {PlaybackReporter,playbackTicks,reportBody,reportPath} from "../src/playback-report";
import type {PlaybackClock,PlaybackReport} from "../src/playback-report";
import {JellyfinApi,SERVER_ORIGIN} from "../src/api";
import {buildShelves} from "../src/discover";

const ITEM="a".repeat(32),SOURCE="b".repeat(32);
const USER="c".repeat(32),TOKEN="d".repeat(64);
const PLAY_SESSION="e".repeat(32);
const snapshot=(seconds=30,more:Partial<PlaybackClock>={}):PlaybackClock=>({
  positionSeconds:seconds,durationSeconds:1800,paused:false,
  muted:false,volume:0.5799999999999999,canSeek:true,...more
});
const context={
  itemId:ITEM,mediaSourceId:SOURCE,playSessionId:PLAY_SESSION,
  playMethod:"Transcode" as const
};
const authResponse=(data:unknown)=>new Response(JSON.stringify(data),{
  headers:{"Content-Type":"application/json"}
});
describe("accurate, non-invasive Jellyfin playback lifecycle",()=>{
  it("uses exact ticks and integer volume in the real playback contracts",()=>{
    expect(playbackTicks(65.1234567)).toBe(651234567);
    expect(playbackTicks(NaN)).toBe(0);
    const data:PlaybackReport={...context,kind:"start",
      positionTicks:651234567,canSeek:true,isPaused:false,
      isMuted:false,volumeLevel:57.99999999999999};
    const body=reportBody(data);
    expect(body).toEqual({
      ItemId:ITEM,MediaSourceId:SOURCE,PlaySessionId:PLAY_SESSION,
      PositionTicks:651234567,PlayMethod:"Transcode",
      IsPaused:false,IsMuted:false,VolumeLevel:58,CanSeek:true
    });
    expect(reportPath("start")).toBe("/Sessions/Playing");
    expect(reportPath("progress")).toBe("/Sessions/Playing/Progress");
    expect(reportPath("stopped")).toBe("/Sessions/Playing/Stopped");
    expect(reportBody({...data,kind:"stopped",failed:false}))
      .toEqual({ItemId:ITEM,MediaSourceId:SOURCE,
        PlaySessionId:PLAY_SESSION,PositionTicks:651234567,Failed:false});
  });
  it("never reports a probe, failed load or a stream stopped before playing",async()=>{
    const write=vi.fn(async(_report:PlaybackReport)=>{});
    const reporter=new PlaybackReporter(context,write);
    reporter.progress(snapshot(),true);
    reporter.pause(snapshot());
    reporter.stop(snapshot(0),true);
    await reporter.drain();
    reporter.playing(snapshot());
    await reporter.drain();
    expect(write).not.toHaveBeenCalled();
  });
  it("reports start only once, throttled progress, pause, seek and stop in order",async()=>{
    let now=1000;
    const reports:PlaybackReport[]=[];
    const write=vi.fn(async(value:PlaybackReport)=>{reports.push(value);});
    const reporter=new PlaybackReporter(context,write,()=>{},()=>now);
    reporter.playing(snapshot(10));
    await reporter.drain();
    reporter.progress(snapshot(12)); // ignored
    reporter.playing(snapshot(20)); // resume reports current progress
    await reporter.drain();
    now=19000;
    reporter.progress(snapshot(40));
    await reporter.drain();
    reporter.pause(snapshot(41,{paused:true}));
    await reporter.drain();
    reporter.progress(snapshot(100),true); // seeked
    await reporter.drain();
    reporter.stop(snapshot(110));
    reporter.stop(snapshot(1800)); // idempotent
    await reporter.drain();
    expect(reports.map(r=>r.kind)).toEqual([
      "start","progress","progress","progress","progress","stopped"
    ]);
    expect(reports[3].isPaused).toBe(true);
    expect(reports.at(-1)?.positionTicks).toBe(1100000000);
  });
  it("coalesces hundreds of fast seeks behind a slow start into one latest progress",async()=>{
    const calls:PlaybackReport[]=[];
    let release:()=>void=()=>{};
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const reporter=new PlaybackReporter(context,async event=>{
      calls.push(event);
      if(event.kind==="start")await gate;
    });
    reporter.playing(snapshot(5));
    for(let seconds=10;seconds<210;seconds++)
      reporter.progress(snapshot(seconds),true);
    release();
    await reporter.drain();
    expect(calls.map(x=>x.kind)).toEqual(["start","progress"]);
    expect(calls[1].positionTicks).toBe(209*10_000_000);
    expect(calls.every(x=>x.itemId===ITEM)).toBe(true);
  });
  it("does not delay a final Stop behind stale queued seeks",async()=>{
    const calls:PlaybackReport[]=[];
    let release:()=>void=()=>{};
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const reporter=new PlaybackReporter(context,async event=>{
      calls.push(event);
      if(event.kind==="start")await gate;
    });
    reporter.playing(snapshot(4));
    for(let seconds=10;seconds<510;seconds++)
      reporter.progress(snapshot(seconds),true);
    reporter.stop(snapshot(515));
    release();
    await reporter.drain();
    expect(calls.map(x=>x.kind)).toEqual(["start","stopped"]);
    expect(calls[1].positionTicks).toBe(515*10_000_000);
    expect(calls[1].failed).toBe(false);
    reporter.progress(snapshot(520),true);
    await reporter.drain();
    expect(calls).toHaveLength(2);
  });
  it("reports actual natural end and not a fabricated earlier finished event",async()=>{
    const calls:PlaybackReport[]=[];
    const reporter=new PlaybackReporter(context,async v=>{calls.push(v);});
    reporter.playing(snapshot(10));
    reporter.ended(snapshot(1799,{durationSeconds:1800}));
    await reporter.drain();
    expect(calls.map(x=>x.kind)).toEqual(["start","stopped"]);
    expect(calls[1].positionTicks).toBe(18_000_000_000);
    expect(calls[1].failed).toBe(false);
  });
  it("does not send progress or stop if Jellyfin refused the start report",async()=>{
    const errors=vi.fn();
    const attempted:PlaybackReport[]=[];
    const reporter=new PlaybackReporter(context,async e=>{
      attempted.push(e);
      throw new Error("offline");
    },errors);
    reporter.playing(snapshot(5));
    reporter.progress(snapshot(60),true);
    reporter.stop(snapshot(61));
    await reporter.drain();
    expect(attempted.map(e=>e.kind)).toEqual(["start"]);
    expect(errors).toHaveBeenCalledTimes(1);
  });
  it("does not leak a stale playback report into a different signed-in session",async()=>{
    const calls:string[]=[];
    let release:(value:Response)=>void=()=>{};
    const fetcher=vi.fn(async(input:RequestInfo|URL):Promise<Response>=>{
      const path=new URL(String(input)).pathname;
      calls.push(path);
      if(path==="/Users/AuthenticateByName")
        return authResponse({User:{Id:USER,Name:"Alice"},AccessToken:TOKEN});
      if(path==="/Users/Me")
        return authResponse({Id:USER,Name:"Alice",Policy:{IsDisabled:false}});
      if(path==="/Sessions/Playing")
        return new Promise<Response>(resolve=>{release=resolve;});
      throw new Error("Unexpected request");
    }) as typeof fetch;
    const api=new JellyfinApi({fetcher});
    await api.login("Alice","password");
    const pending=api.reportPlayback({...context,kind:"start",
      positionTicks:0,canSeek:true,isPaused:false,isMuted:false,
      volumeLevel:68});
    await vi.waitFor(()=>expect(calls).toContain("/Sessions/Playing"));
    api.logout();
    release(new Response(null,{status:204}));
    await expect(pending).rejects.toThrow("SESSION_CHANGED");
    await expect(api.reportPlayback({...context,kind:"progress",
      positionTicks:100,canSeek:true,isPaused:false,isMuted:false,
      volumeLevel:68})).rejects.toThrow("AUTH_REQUIRED");
  });
  it("aborts every in-flight write on logout, then permits the next session",async()=>{
    const aborted:AbortSignal[]=[];
    let writes=0;
    const fetcher=vi.fn(async(input:RequestInfo|URL,opts:RequestInit={})=>{
      const path=new URL(String(input)).pathname;
      if(path==="/Users/AuthenticateByName")
        return authResponse({User:{Id:USER,Name:"Alice"},AccessToken:TOKEN});
      if(path==="/Users/Me")
        return authResponse({Id:USER,Name:"Alice",Policy:{IsDisabled:false}});
      if(path.startsWith("/Sessions/Playing")){
        writes++;
        if(writes===3)return new Response(null,{status:204});
        const signal=opts.signal;
        if(!(signal instanceof AbortSignal))
          throw new Error("MISSING_ABORT_SIGNAL");
        aborted.push(signal);
        return new Promise<Response>((_resolve,reject)=>{
          signal.addEventListener("abort",()=>{
            reject(new DOMException("Aborted","AbortError"));
          },{once:true});
        });
      }
      throw new Error("UNEXPECTED_REQUEST");
    }) as typeof fetch;
    const api=new JellyfinApi({fetcher});
    await api.login("Alice","password");
    const data:PlaybackReport={...context,kind:"start",
      positionTicks:0,canSeek:true,isPaused:false,isMuted:false,
      volumeLevel:58};
    const pendingStart=api.reportPlayback(data);
    const pendingProgress=api.reportPlayback({...data,kind:"progress",
      positionTicks:250_000_000});
    await vi.waitFor(()=>expect(aborted).toHaveLength(2));
    api.logout();
    expect(aborted.every(signal=>signal.aborted)).toBe(true);
    await expect(pendingStart).rejects.toThrow("SESSION_CHANGED");
    await expect(pendingProgress).rejects.toThrow("SESSION_CHANGED");
    await api.login("Alice","password");
    await expect(api.reportPlayback(data)).resolves.toBeUndefined();
    expect(writes).toBe(3);
  });
  it("keeps the player independent from a forbidden Jellyfin report",async()=>{
    const writes:PlaybackReport[]=[];
    const recorder=new PlaybackReporter(context,async value=>{
      writes.push(value);
      throw new Error("HTTP 403");
    });
    recorder.playing(snapshot(21));
    recorder.progress(snapshot(50),true);
    recorder.stop(snapshot(80));
    await recorder.drain();
    expect(writes.map(x=>x.kind)).toEqual(["start"]);
    // No second write can bypass the refused start, and the controller
    // did not throw an exception into the video playback event handler.
  });
  it("reports server-authorized HLS remux as DirectStream, not a re-encode",()=>{
    const report:PlaybackReport={...context,playMethod:"DirectStream",
      kind:"start",positionTicks:10000000,isPaused:false,isMuted:true,
      volumeLevel:45,canSeek:true};
    expect(reportBody(report).PlayMethod).toBe("DirectStream");
    expect(reportBody({...report,kind:"progress"}).PlayMethod)
      .toBe("DirectStream");
  });
  it("POSTs authenticated 204 playback reports without token URLs or JSON response",async()=>{
    const calls:Array<{url:URL,opts:RequestInit}>=[];
    const fetcher=vi.fn(async(input:RequestInfo|URL,opts:RequestInit={})=>{
      const url=new URL(String(input));calls.push({url,opts});
      if(url.pathname==="/Users/AuthenticateByName")
        return authResponse({User:{Id:USER,Name:"Alice"},AccessToken:TOKEN});
      if(url.pathname==="/Users/Me")
        return authResponse({Id:USER,Name:"Alice",Policy:{IsDisabled:false}});
      if(url.pathname.startsWith("/Sessions/Playing"))
        return new Response(null,{status:204});
      throw new Error("Unexpected request");
    }) as typeof fetch;
    const api=new JellyfinApi({fetcher});
    await api.login("Alice","password");
    const data:PlaybackReport={...context,kind:"start",positionTicks:0,
      canSeek:true,isPaused:false,isMuted:false,volumeLevel:58};
    await api.reportPlayback(data);
    await api.reportPlayback({...data,kind:"progress",positionTicks:150000000});
    await api.reportPlayback({...data,kind:"stopped",positionTicks:300000000});
    const writes=calls.slice(-3);
    expect(writes.map(x=>x.url.pathname)).toEqual([
      "/Sessions/Playing","/Sessions/Playing/Progress",
      "/Sessions/Playing/Stopped"
    ]);
    expect(writes.every(x=>x.url.origin===SERVER_ORIGIN &&
      !x.url.href.includes(TOKEN) && x.opts.method==="POST" &&
      x.opts.credentials==="omit" && x.opts.redirect==="error"))
      .toBe(true);
    expect(writes.every(x=>(x.opts.headers as Record<string,string>)
      .Authorization.includes(TOKEN))).toBe(true);
    expect(JSON.parse(String(writes[0].opts.body)).VolumeLevel).toBe(58);
    expect(JSON.parse(String(writes[2].opts.body)).Failed).toBe(false);
    await expect(api.reportPlayback({...data,itemId:"../other"}))
      .rejects.toThrow("PLAYBACK_REPORT_INVALID");
    api.logout();
    await expect(api.reportPlayback(data)).rejects.toThrow("AUTH_REQUIRED");
  });
  it("reconciles partial resume and the following episode using an isolated in-memory Jellyfin",async()=>{
    // Contract integration, NOT a live Jellyfin write. The mock returns the
    // same endpoints and 204 acknowledgements as Jellyfin and maintains a
    // disposable user's progress entirely inside this Vitest process.
    const SERIES="1".repeat(32),NEXT="2".repeat(32);
    const runtime=1_800*10_000_000;
    const completedRuntime=1_200*10_000_000;
    const writes:Array<{path:string,body:Record<string,unknown>}>=[];
    let moviePosition=0,episodePosition=0,episodeCompleted=false;
    const fetcher=vi.fn(async(input:RequestInfo|URL,opts:RequestInit={})=>{
      const url=new URL(String(input)),path=url.pathname;
      if(url.origin!==SERVER_ORIGIN)throw new Error("UNEXPECTED_ORIGIN");
      if(path==="/Users/AuthenticateByName")
        return authResponse({User:{Id:USER,Name:"QA fixture"},
          AccessToken:TOKEN});
      if(path==="/Users/Me")
        return authResponse({Id:USER,Name:"QA fixture",Policy:{IsDisabled:false}});
      if(path.startsWith("/Sessions/Playing")){
        const body=JSON.parse(String(opts.body)) as Record<string,unknown>;
        const item=body.ItemId,position=body.PositionTicks;
        if(!Number.isSafeInteger(position) || (position as number)<0)
          throw new Error("BAD_POSITION");
        writes.push({path,body});
        if(path==="/Sessions/Playing/Stopped"){
          if(item===ITEM)moviePosition=position as number;
          if(item===SOURCE){
            episodePosition=position as number;
            episodeCompleted=episodePosition>=completedRuntime;
          }
        }
        return new Response(null,{status:204});
      }
      if(path==="/UserItems/Resume"){
        if(url.searchParams.get("userId")!==USER)
          throw new Error("WRONG_SCOPED_USER");
        return authResponse({Items:moviePosition>0?[{
          Id:ITEM,Type:"Movie",Name:"Film interrompu",
          RunTimeTicks:runtime,
          ImageTags:{Primary:"present"},
          UserData:{Played:false,PlaybackPositionTicks:moviePosition}
        }]:[]});
      }
      if(path==="/Shows/NextUp"){
        if(url.searchParams.get("userId")!==USER)
          throw new Error("WRONG_SCOPED_USER");
        return authResponse({Items:[{
          Id:episodeCompleted?NEXT:SOURCE,
          SeriesId:SERIES,Type:"Episode",
          Name:episodeCompleted?"Épisode suivant":"Épisode en cours",
          ParentIndexNumber:1,IndexNumber:episodeCompleted?2:1,
          RunTimeTicks:completedRuntime,ImageTags:{Primary:"present"},
          UserData:{Played:false,PlaybackPositionTicks:0}
        }],TotalRecordCount:1});
      }
      throw new Error("UNEXPECTED_REQUEST");
    }) as typeof fetch;
    const api=new JellyfinApi({fetcher,deviceId:"vyneo-progress-fixture"});
    await api.login("QA fixture","not-a-live-password");

    const movie=new PlaybackReporter(context,report=>api.reportPlayback(report));
    movie.playing(snapshot(10));
    movie.pause(snapshot(73,{paused:true}));
    await movie.drain(); // An actual network interval before the final stop.
    movie.stop(snapshot(73,{paused:true}));
    await movie.drain();
    const resume=await api.getResume();
    expect(resume).toHaveLength(1);
    expect(resume[0].resumeTicks).toBe(730_000_000);
    expect(resume[0].progress).toBe(4);
    expect((await api.getNextUp())[0].id).toBe(SOURCE);

    const episodeContext={...context,itemId:SOURCE,
      mediaSourceId:"3".repeat(32)};
    const episode=new PlaybackReporter(episodeContext,
      report=>api.reportPlayback(report));
    episode.playing(snapshot(40,{durationSeconds:1200}));
    episode.ended(snapshot(1198,{durationSeconds:1200}));
    await episode.drain();
    const nextUp=await api.getNextUp();
    expect(nextUp.map(x=>x.id)).toEqual([NEXT]);
    expect(nextUp[0].episodeNumber).toBe(2);
    const shelves=buildShelves({
      recent:[],resume,nextUp,favorites:[],watched:[],collections:[]
    },USER,new Date("2026-10-25"));
    expect(shelves.find(x=>x.id==="resume")?.items[0].resumeTicks)
      .toBe(730_000_000);
    expect(shelves.find(x=>x.id==="next-up")?.items[0].id).toBe(NEXT);
    expect(writes.map(x=>x.path)).toEqual([
      "/Sessions/Playing","/Sessions/Playing/Progress",
      "/Sessions/Playing/Stopped",
      "/Sessions/Playing","/Sessions/Playing/Stopped"
    ]);
    expect(writes.at(-1)?.body).toMatchObject({
      ItemId:SOURCE,PositionTicks:completedRuntime,Failed:false
    });
    expect(writes.every(x=>!JSON.stringify(x.body).includes(TOKEN)))
      .toBe(true);
    api.logout();
  });

});
