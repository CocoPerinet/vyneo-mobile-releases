import {describe,it,expect,vi} from "vitest";
import {FLUSH_ACTIVE_PLAYBACK_EVENT,flushActivePlayback,
  trackFinalPlaybackReport} from "../src/playback-window-lifecycle";
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
