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
export async function flushActivePlayback(
  target:EventTarget,deadlineMs=2500
):Promise<FlushStatus>{
  const pending:Promise<void>[]=[];
  target.dispatchEvent(new CustomEvent<PlaybackFlushDetail>(
    FLUSH_ACTIVE_PLAYBACK_EVENT,{
      detail:{waitUntil:(job)=>pending.push(job)}
    }));
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
