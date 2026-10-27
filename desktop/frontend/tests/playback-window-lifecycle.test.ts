import {describe,it,expect,vi} from "vitest";
import {FLUSH_ACTIVE_PLAYBACK_EVENT,flushActivePlayback,
  trackFinalPlaybackReport,acknowledgeNativeWindowAction,
  NATIVE_WINDOW_ACTION_EVENT,stopPlaybackBeforeClosing}
  from "../src/playback-window-lifecycle";
import type {PlaybackFlushDetail} from "../src/playback-window-lifecycle";
import {PlaybackReporter} from "../src/playback-report";
import type {PlaybackClock,PlaybackReport} from "../src/playback-report";

describe("native hide and logout final report handshake",()=>{
  it("completes immediately with no active reporter",async()=>{
    expect(await flushActivePlayback(new EventTarget(),100))
      .toBe("drained");
  });
  it("waits until the real reporter's queued Stop has settled",async()=>{
    const target=new EventTarget();
    let done!:()=>void;
    const report=new Promise<void>(resolve=>{done=resolve;});
    target.addEventListener(FLUSH_ACTIVE_PLAYBACK_EVENT,event=>{
      const detail=(event as CustomEvent<PlaybackFlushDetail>).detail;
      detail.waitUntil(report);
    });
    const settled=vi.fn();
    const flush=flushActivePlayback(target,1000).then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    done();
    await flush;
    expect(settled).toHaveBeenCalledWith("drained");
  });
  it("waits for genuine PlaybackReporter Start and Stopped acknowledgments before logout",async()=>{
    const target=new EventTarget();
    const sent:PlaybackReport[]=[];
    let acceptStart!:()=>void,acceptStop!:()=>void;
    const startGate=new Promise<void>(resolve=>{acceptStart=resolve;});
    const stopGate=new Promise<void>(resolve=>{acceptStop=resolve;});
    const snapshot=(seconds:number):PlaybackClock=>({
      positionSeconds:seconds,durationSeconds:120,paused:false,
      muted:false,volume:1,canSeek:true
    });
    const reporter=new PlaybackReporter({
      itemId:"a".repeat(32),mediaSourceId:"b".repeat(32),
      playSessionId:null,playMethod:"Transcode"
    },async report=>{
      sent.push(report);
      if(report.kind==="start")await startGate;
      if(report.kind==="stopped")await stopGate;
    });
    reporter.playing(snapshot(10));
    target.addEventListener(FLUSH_ACTIVE_PLAYBACK_EVENT,event=>{
      reporter.stop(snapshot(43));
      (event as CustomEvent<PlaybackFlushDetail>).detail
        .waitUntil(reporter.drain());
    });
    const completed=vi.fn();
    const flush=flushActivePlayback(target,1000).then(completed);
    expect(sent.map(x=>x.kind)).toEqual(["start"]);
    expect(completed).not.toHaveBeenCalled();
    acceptStart();
    await vi.waitFor(()=>expect(sent.map(x=>x.kind))
      .toEqual(["start","stopped"]));
    expect(completed).not.toHaveBeenCalled();
    acceptStop();
    await flush;
    expect(completed).toHaveBeenCalledWith("drained");
    expect(sent[1].positionTicks).toBe(430_000_000);
    // Closing twice cannot produce two terminal Jellyfin reports.
    expect(await flushActivePlayback(target,100)).toBe("drained");
    expect(sent).toHaveLength(2);
  });
  it("does not report a never-started video during native close",async()=>{
    const target=new EventTarget();
    const write=vi.fn(async(_report:PlaybackReport)=>{});
    const reporter=new PlaybackReporter({
      itemId:"a".repeat(32),mediaSourceId:"b".repeat(32),
      playSessionId:null,playMethod:"Transcode"
    },write);
    target.addEventListener(FLUSH_ACTIVE_PLAYBACK_EVENT,event=>{
      reporter.stop({positionSeconds:0,durationSeconds:0,
        paused:true,muted:false,volume:1,canSeek:false});
      (event as CustomEvent<PlaybackFlushDetail>).detail
        .waitUntil(reporter.drain());
    });
    expect(await flushActivePlayback(target,100)).toBe("drained");
    expect(write).not.toHaveBeenCalled();
  });
  it("a simultaneous native quit waits for the pending Stop after its dialog is gone",async()=>{
    const target=new EventTarget();
    let allowStop!:()=>void;
    const stopReport=new Promise<void>(resolve=>{allowStop=resolve;});
    let hasStopped=false;
    target.addEventListener(FLUSH_ACTIVE_PLAYBACK_EVENT,event=>{
      if(hasStopped)return;
      hasStopped=true;
      trackFinalPlaybackReport(stopReport);
      (event as CustomEvent<PlaybackFlushDetail>).detail
        .waitUntil(stopReport);
    });
    const firstCompleted=vi.fn(),secondCompleted=vi.fn();
    const logout=flushActivePlayback(target,1000).then(firstCompleted);
    // A second event may arrive after the details have been removed from DOM.
    const quit=flushActivePlayback(new EventTarget(),1000)
      .then(secondCompleted);
    await Promise.resolve();
    expect(firstCompleted).not.toHaveBeenCalled();
    expect(secondCompleted).not.toHaveBeenCalled();
    allowStop();
    await Promise.all([logout,quit]);
    expect(firstCompleted).toHaveBeenCalledWith("drained");
    expect(secondCompleted).toHaveBeenCalledWith("drained");
  });
  it("a rejected final Stop does not poison future shutdown requests",async()=>{
    trackFinalPlaybackReport(Promise.reject(
      new Error("PLAYBACK_REPORT_NETWORK")));
    expect(await flushActivePlayback(new EventTarget(),100))
      .toBe("drained");
    expect(await flushActivePlayback(new EventTarget(),100))
      .toBe("drained");
  });
  it("accepts superseding Quit while Hide waits for a real final Stop",async()=>{
    const target=new EventTarget();
    let resolveStop!:()=>void;
    const stopGate=new Promise<void>(resolve=>{resolveStop=resolve;});
    const reports:PlaybackReport[]=[];
    const reporter=new PlaybackReporter({
      itemId:"a".repeat(32),mediaSourceId:"b".repeat(32),
      playSessionId:null,playMethod:"Transcode"
    },async report=>{
      reports.push(report);
      if(report.kind==="stopped")await stopGate;
    });
    const snapshot=(seconds:number):PlaybackClock=>({
      positionSeconds:seconds,durationSeconds:90,paused:false,
      muted:false,volume:1,canSeek:true
    });
    reporter.playing(snapshot(5));
    await reporter.drain();
    target.addEventListener(FLUSH_ACTIVE_PLAYBACK_EVENT,event=>{
      reporter.stop(snapshot(32));
      const stopped=reporter.drain();
      trackFinalPlaybackReport(stopped);
      (event as CustomEvent<PlaybackFlushDetail>).detail
        .waitUntil(stopped);
    });
    const attempted:string[]=[];
    const accepted:string[]=[];
    const complete=vi.fn(async(action:"hide"|"quit",generation:number)=>{
      attempted.push(action+":"+generation);
      // Native Rust has advanced to generation 2: Hide 1 is stale.
      if(generation!==2)throw new Error("WINDOW_ACTION_NOT_PENDING");
      accepted.push(action+":"+generation);
    });
    const event=(action:"hide"|"quit",generation:number)=>
      new CustomEvent(NATIVE_WINDOW_ACTION_EVENT,{
        detail:{action,generation}
      });
    const hide=acknowledgeNativeWindowAction(event("hide",1),
      target,complete);
    const quit=acknowledgeNativeWindowAction(event("quit",2),
      target,complete);
    await Promise.resolve();
    expect(complete).not.toHaveBeenCalled();
    resolveStop();
    await Promise.all([hide,quit]);
    expect(attempted).toEqual(["hide:1","quit:2"]);
    expect(accepted).toEqual(["quit:2"]);
    expect(reports.map(report=>report.kind))
      .toEqual(["start","stopped"]);
    expect(reports[1].positionTicks).toBe(320_000_000);
  });
  it("ignores malformed and forged native window action details",async()=>{
    const complete=vi.fn(async()=>{});
    const target=new EventTarget();
    for(const detail of [
      null,{action:"close",generation:1},
      {action:"quit",generation:0},
      {action:"quit",generation:2.5},
      {action:"quit",generation:Number.MAX_SAFE_INTEGER+1},
      {action:"hide",generation:"3"}
    ]){
      await acknowledgeNativeWindowAction(
        new CustomEvent(NATIVE_WINDOW_ACTION_EVENT,{detail}),
        target,complete);
    }
    expect(complete).not.toHaveBeenCalled();
  });
  it("sends the last Stopped before X/Escape removes the video binding",async()=>{
    const sent:PlaybackReport[]=[];
    let allowStopped!:()=>void;
    const stopGate=new Promise<void>(resolve=>{allowStopped=resolve;});
    const reporter=new PlaybackReporter({
      itemId:"a".repeat(32),mediaSourceId:"b".repeat(32),
      playSessionId:null,playMethod:"DirectPlay"
    },async report=>{
      sent.push(report);
      if(report.kind==="stopped")await stopGate;
    });
    const clock=(pos:number):PlaybackClock=>({
      positionSeconds:pos,durationSeconds:120,
      paused:false,muted:false,volume:1,canSeek:true
    });
    reporter.playing(clock(3));
    await reporter.drain();
    let videoStillBound=true;
    let closeCount=0;
    stopPlaybackBeforeClosing(()=>{
      expect(videoStillBound).toBe(true);
      reporter.stop(clock(43));
      trackFinalPlaybackReport(reporter.drain());
    },()=>{
      videoStillBound=false;closeCount++;
      expect(sent.map(x=>x.kind)).toEqual(["start","stopped"]);
    });
    expect(closeCount).toBe(1);
    let drained=false;
    const pending=flushActivePlayback(new EventTarget(),1000)
      .then(status=>{drained=status==="drained";});
    await Promise.resolve();
    expect(drained).toBe(false);
    allowStopped();
    await pending;
    expect(drained).toBe(true);
    expect(sent[1].positionTicks).toBe(430_000_000);
    // The later component onDestroy cleanup is idempotent.
    reporter.stop(clock(70));
    await reporter.drain();
    expect(sent).toHaveLength(2);
  });
  it("still closes the detail if a media teardown throws",()=>{
    const done=vi.fn();
    expect(()=>stopPlaybackBeforeClosing(()=>{
      throw new Error("VIDEO_TEARDOWN_FAILED");
    },done)).toThrow("VIDEO_TEARDOWN_FAILED");
    expect(done).toHaveBeenCalledTimes(1);
  });
  it("closing a detail without playback never creates watch history",async()=>{
    const events:PlaybackReport[]=[];
    const reporter=new PlaybackReporter({
      itemId:"a".repeat(32),mediaSourceId:"b".repeat(32),
      playSessionId:null,playMethod:"Transcode"
    },async report=>{events.push(report);});
    const done=vi.fn();
    stopPlaybackBeforeClosing(()=>{
      reporter.stop({
        positionSeconds:0,durationSeconds:0,paused:true,
        muted:false,volume:1,canSeek:false
      });
      trackFinalPlaybackReport(reporter.drain());
    },done);
    await flushActivePlayback(new EventTarget(),100);
    expect(done).toHaveBeenCalledOnce();
    expect(events).toHaveLength(0);
  });
  it("does not hang a native close on an unresponsive server",async()=>{
    const target=new EventTarget();
    target.addEventListener(FLUSH_ACTIVE_PLAYBACK_EVENT,event=>{
      (event as CustomEvent<PlaybackFlushDetail>).detail
        .waitUntil(new Promise<void>(()=>{}));
    });
    expect(await flushActivePlayback(target,10)).toBe("timed-out");
  });
  it("finishes even if Jellyfin refuses the last report",async()=>{
    const target=new EventTarget();
    target.addEventListener(FLUSH_ACTIVE_PLAYBACK_EVENT,event=>{
      (event as CustomEvent<PlaybackFlushDetail>).detail
        .waitUntil(Promise.reject(new Error("PLAYBACK_REPORT_DENIED")));
    });
    expect(await flushActivePlayback(target,100)).toBe("drained");
  });
});
