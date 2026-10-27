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

export type NativeWindowAction="hide"|"quit";
export interface NativeWindowActionRequest {
  action:NativeWindowAction;
  generation:number;
}
/** Every native request needs an independent final report flush. A Quit may
 * supersede Hide while it is awaiting Jellyfin; the Rust generation guard
 * rejects the stale Hide ACK. Never drop the newer action in the renderer. */
export async function acknowledgeNativeWindowAction(
  event:Event,
  target:EventTarget,
  complete:(action:NativeWindowAction,generation:number)=>Promise<unknown>
):Promise<void>{
  const detail=(event as CustomEvent<unknown>).detail;
  if(!detail || typeof detail!=="object")return;
  const {action,generation}=detail as Partial<NativeWindowActionRequest>;
  if((action!=="hide" && action!=="quit") ||
    typeof generation!=="number" ||
    !Number.isSafeInteger(generation) || generation<=0)return;
  try{
    await flushActivePlayback(target);
    // Only Rust may decide whether this exact generation is still current.
    await complete(action,generation);
  }catch{
    // A stale ACK is expected if Quit replaced Hide. For a genuine failure,
    // the native timeout remains the fail-safe.
  }
}
