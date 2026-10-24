// Native Jellyfin HLS proxy allows one cold segment request up to 90s.
// hls.js sees the first byte only AFTER the proxy has fully received that
// upstream segment, so its cold first-byte timeout must be slightly higher.
// Restore normal stall detection immediately after the first loaded segment.
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
