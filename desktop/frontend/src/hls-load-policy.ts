// Native Jellyfin HLS proxy allows one cold segment request up to 90s.
// hls.js sees the first byte only AFTER the proxy has fully received that
// upstream segment, so its cold first-byte timeout must be slightly higher.
// Use an adaptive, bounded warm deadline: real remote STRM fragments can
// legitimately need 12-30s for their first byte AFTER playback has started.
// A fixed 12s warm timeout aborts playable Jellyfin remuxes during seeks.
export const HLS_COLD_FIRST_BYTE_MS=95_000;
export const HLS_WARM_FIRST_BYTE_MS=30_000;
export const HLS_MAX_WARM_FIRST_BYTE_MS=90_000;
export const HLS_MAX_FRAGMENT_LOAD_MS=120_000;

export function initialHlsFragmentPolicy(){
  return {
    default:{
      maxTimeToFirstByteMs:HLS_COLD_FIRST_BYTE_MS,
      maxLoadTimeMs:HLS_MAX_FRAGMENT_LOAD_MS,
      timeoutRetry:{maxNumRetry:0,retryDelayMs:0,maxRetryDelayMs:0},
      errorRetry:{
        maxNumRetry:1,retryDelayMs:1000,maxRetryDelayMs:3000,
        backoff:"linear" as const
      }
    }
  };
}
/** Drop the cold-start grace period only once an actual resume fragment
 * arrives, but keep a bounded allowance for slow STRM upstream generation.
 * The observed time is measured between HLS.js request and first byte, not
 * the total download duration. Never decrease an already learned deadline. */
export function firstFragmentReceived(
  policy:{default:{maxTimeToFirstByteMs:number}},
  observedFirstByteMs:number=0
):void{
  const observed=Number.isFinite(observedFirstByteMs) &&
    observedFirstByteMs>0
    ?Math.min(HLS_MAX_WARM_FIRST_BYTE_MS,
      Math.ceil(observedFirstByteMs*2.5))
    :0;
  const previous=policy.default.maxTimeToFirstByteMs;
  const warmPrevious=previous===HLS_COLD_FIRST_BYTE_MS
    ?HLS_WARM_FIRST_BYTE_MS:previous;
  policy.default.maxTimeToFirstByteMs=Math.min(
    HLS_MAX_WARM_FIRST_BYTE_MS,
    Math.max(HLS_WARM_FIRST_BYTE_MS,warmPrevious,observed)
  );
}

/** The first fragments of a replacement HLS stream may be near 0 seconds,
 * not near the user's retained seek position. Keep the cold first-byte
 * budget until a fragment near that position actually finishes loading.
 * No URL, token, session or media content is required to make this choice. */
export function fragmentReachesResumePosition(
  resumeSeconds:number|null,fragStart:number,fragDuration:number
):boolean{
  if(resumeSeconds===null || resumeSeconds===0)return true;
  if(!Number.isFinite(resumeSeconds) || resumeSeconds<0 ||
     !Number.isFinite(fragStart) || fragStart<0 ||
     !Number.isFinite(fragDuration) || fragDuration<=0)return false;
  // One segment of tolerance handles 6s HLS keyframe alignment. A
  // fragment at the very start must not release a 4-minute seek budget.
  const tolerance=Math.min(fragDuration,6);
  return fragStart<=resumeSeconds+tolerance &&
    fragStart+fragDuration+tolerance>=resumeSeconds;
}
