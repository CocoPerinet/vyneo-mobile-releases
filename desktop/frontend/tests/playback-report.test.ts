import {describe,it,expect,vi} from "vitest";
import {PlaybackReporter,playbackTicks,reportBody,reportPath} from "../src/playback-report";
import type {PlaybackClock,PlaybackReport} from "../src/playback-report";
import {JellyfinApi,SERVER_ORIGIN} from "../src/api";

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
    reporter.progress(snapshot(12)); // ignored
    reporter.playing(snapshot(20)); // resume reports current progress
    now=19000;
    reporter.progress(snapshot(40));
    reporter.pause(snapshot(41,{paused:true}));
    reporter.progress(snapshot(100),true); // seeked
    reporter.stop(snapshot(110));
    reporter.stop(snapshot(1800)); // idempotent
    await reporter.drain();
    expect(reports.map(r=>r.kind)).toEqual([
      "start","progress","progress","progress","progress","stopped"
    ]);
    expect(reports[3].isPaused).toBe(true);
    expect(reports.at(-1)?.positionTicks).toBe(1100000000);
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
});
