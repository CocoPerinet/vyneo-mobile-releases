/** Track switches replace the media element source. Preserve user playback
 * intent, including an intentional pause and an exact 0-second seek.
 * Never store credentials or media URLs in this state.
 */
export interface PlaybackSwitchState {
  seekSeconds:number|null;
  volume:number|null;
  muted:boolean|null;
  paused:boolean|null;
}
type SwitchableMedia=Pick<HTMLMediaElement,
  "currentTime"|"volume"|"muted"|"paused">;

export function capturePlaybackSwitch(
  media:SwitchableMedia|null|undefined
):PlaybackSwitchState {
  if(!media)return {
    seekSeconds:null,volume:null,muted:null,paused:null
  };
  const seconds=media.currentTime;
  const volume=media.volume;
  return {
    // An exact zero remains zero: null would incorrectly fall back to
    // Jellyfin's earlier resume position after a track change.
    seekSeconds:Number.isFinite(seconds) && seconds>=0?seconds:null,
    volume:Number.isFinite(volume) && volume>=0 && volume<=1?volume:null,
    muted:media.muted,
    paused:media.paused
  };
}

/** Fresh playback starts by default; switching an intentionally paused
 * track must wait for an explicit Play action on the new source.
 */
export function shouldAutoplayAfterSwitch(paused:boolean|null):boolean{
  return paused!==true;
}
