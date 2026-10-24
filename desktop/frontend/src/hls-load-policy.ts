// Native Jellyfin HLS proxy allows one cold segment request up to 90s.
// hls.js sees the first byte only AFTER the proxy has fully received that
// upstream segment, so its cold first-byte timeout must be slightly higher.
// Restore normal stall detection after the initial segment, except when
// switching tracks while seeking into an unbuffered STRM position.
// Jellyfin can produce 0.ts quickly but need >12s for segment ~4m25s.
export const HLS_COLD_FIRST_BYTE_MS=95_000;
export const HLS_WARM_FIRST_BYTE_MS=12_000;
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
export function firstFragmentReceived(
  policy:{default:{maxTimeToFirstByteMs:number}}
):void{
  policy.default.maxTimeToFirstByteMs=HLS_WARM_FIRST_BYTE_MS;
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
