/** A narrow, synchronous event contract: the active video detail revokes its
 * native media ticket and registers the final Stopped promise immediately.
 * Native hide/quit and explicit logout then wait at most 2.5 seconds before
 * leaving; a stuck Jellyfin server must not freeze the application. */
export const FLUSH_ACTIVE_PLAYBACK_EVENT="vyneo:flush-active-playback";
export const NATIVE_WINDOW_ACTION_EVENT="vyneo:native-window-action";
export interface PlaybackFlushDetail{
  waitUntil:(pending:Promise<void>)=>void;
}
export type FlushStatus="drained"|"timed-out";
// Keep final Jellyfin Stopped writes observable even after the media
// details component unmounts. Concurrent logout/hide/quit must all wait
// for the same outstanding report (up to their bounded native deadline).
const pendingFinalReports=new Set<Promise<void>>();
export function trackFinalPlaybackReport(report:Promise<void>):void{
  pendingFinalReports.add(report);
  void report.then(
    ()=>{pendingFinalReports.delete(report);},
    ()=>{pendingFinalReports.delete(report);}
  );
}
export async function flushActivePlayback(
  target:EventTarget,deadlineMs=2500
):Promise<FlushStatus>{
  const pending:Promise<void>[]=[];
  target.dispatchEvent(new CustomEvent<PlaybackFlushDetail>(
    FLUSH_ACTIVE_PLAYBACK_EVENT,{
      detail:{waitUntil:(job)=>pending.push(job)}
    }));
  // Include previous Stop requests, even if the video dialog has already
  // closed or another simultaneous window action consumed its reporter.
  if(pendingFinalReports.size)
    pending.push(Promise.allSettled([...pendingFinalReports]).then(()=>{}));
  if(!pending.length)return "drained";
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{
    return await Promise.race([
      Promise.allSettled(pending).then(()=>"drained" as const),
      new Promise<"timed-out">(resolve=>{
        timeout=setTimeout(()=>resolve("timed-out"),deadlineMs);
      })
    ]);
  }finally{
    if(timeout!==undefined)clearTimeout(timeout);
  }
}
