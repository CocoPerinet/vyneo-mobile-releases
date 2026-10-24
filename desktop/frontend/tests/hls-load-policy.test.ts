import {describe,expect,it} from "vitest";
import {HLS_COLD_FIRST_BYTE_MS,HLS_WARM_FIRST_BYTE_MS,
  HLS_MAX_FRAGMENT_LOAD_MS,initialHlsFragmentPolicy,
  firstFragmentReceived} from "../src/hls-load-policy";

describe("cold Jellyfin STRM HLS startup does not disable regular stall detection",()=>{
  it("allows the native 90s first-segment warmup without unlimited retries",()=>{
    const policy=initialHlsFragmentPolicy();
    expect(HLS_COLD_FIRST_BYTE_MS).toBe(95_000);
    expect(policy.default.maxTimeToFirstByteMs).toBeGreaterThan(90_000);
    expect(policy.default.maxLoadTimeMs).toBe(HLS_MAX_FRAGMENT_LOAD_MS);
    expect(policy.default.timeoutRetry.maxNumRetry).toBe(0);
    expect(policy.default.errorRetry.maxNumRetry).toBe(1);
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
