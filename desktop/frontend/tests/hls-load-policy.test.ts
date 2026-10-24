import {describe,expect,it} from "vitest";
import {HLS_COLD_FIRST_BYTE_MS,HLS_WARM_FIRST_BYTE_MS,
  HLS_MAX_FRAGMENT_LOAD_MS,initialHlsFragmentPolicy,
  firstFragmentReceived,fragmentReachesResumePosition}
  from "../src/hls-load-policy";

describe("cold Jellyfin STRM HLS startup does not disable regular stall detection",()=>{
  it("allows the native 90s first-segment warmup without unlimited retries",()=>{
    const policy=initialHlsFragmentPolicy();
    expect(HLS_COLD_FIRST_BYTE_MS).toBe(95_000);
    expect(policy.default.maxTimeToFirstByteMs).toBeGreaterThan(90_000);
    expect(policy.default.maxLoadTimeMs).toBe(HLS_MAX_FRAGMENT_LOAD_MS);
    expect(policy.default.timeoutRetry.maxNumRetry).toBe(0);
    expect(policy.default.errorRetry.maxNumRetry).toBe(1);
  });
  it("keeps the cold deadline during a paused 4m25s HLS track switch",()=>{
    const policy=initialHlsFragmentPolicy();
    const target=265;
    // The HLS.js prefetch of 0.ts must not turn future 4m25s network
    // requests into 12-second timeouts.
    for(const [start,duration] of [[0,6],[6,6],[252,6]]){
      expect(fragmentReachesResumePosition(target,start,duration))
        .toBe(false);
      expect(policy.default.maxTimeToFirstByteMs)
        .toBe(HLS_COLD_FIRST_BYTE_MS);
    }
    expect(fragmentReachesResumePosition(target,264,6)).toBe(true);
    firstFragmentReceived(policy);
    expect(policy.default.maxTimeToFirstByteMs)
      .toBe(HLS_WARM_FIRST_BYTE_MS);
    // A fragment just after a keyframe-aligned target is also valid.
    expect(fragmentReachesResumePosition(target,270,6)).toBe(true);
    expect(fragmentReachesResumePosition(target,400,6)).toBe(false);
  });
  it("rejects invalid fragment metadata for a pending seek",()=>{
    expect(fragmentReachesResumePosition(null,0,6)).toBe(true);
    expect(fragmentReachesResumePosition(0,0,6)).toBe(true);
    expect(fragmentReachesResumePosition(265,NaN,6)).toBe(false);
    expect(fragmentReachesResumePosition(265,-1,6)).toBe(false);
    expect(fragmentReachesResumePosition(265,264,0)).toBe(false);
    expect(fragmentReachesResumePosition(265,264,Infinity)).toBe(false);
    expect(fragmentReachesResumePosition(Infinity,264,6)).toBe(false);
  });
  it("returns to short deadlines as soon as the first segment is loaded",()=>{
    const a=initialHlsFragmentPolicy();
    const b=initialHlsFragmentPolicy();
    firstFragmentReceived(a);
    expect(a.default.maxTimeToFirstByteMs).toBe(HLS_WARM_FIRST_BYTE_MS);
    expect(b.default.maxTimeToFirstByteMs).toBe(HLS_COLD_FIRST_BYTE_MS);
    firstFragmentReceived(a);
    expect(a.default.maxTimeToFirstByteMs).toBe(HLS_WARM_FIRST_BYTE_MS);
  });
});
