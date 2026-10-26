import {describe,it,expect,vi} from "vitest";
import {FLUSH_ACTIVE_PLAYBACK_EVENT,flushActivePlayback}
  from "../src/playback-window-lifecycle";
import type {PlaybackFlushDetail} from "../src/playback-window-lifecycle";

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
