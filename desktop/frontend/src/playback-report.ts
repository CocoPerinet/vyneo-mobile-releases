/** Jellyfin playback reporting is opt-in only after HTMLMediaElement fires
 * "playing". An inspect/probe or a failed native media stream must NOT change
 * the server's resume positions or history. No token is in these objects. */
export type PlaybackEventKind="start"|"progress"|"stopped";
export type PlaybackMethod="DirectPlay"|"DirectStream"|"Transcode";
export interface PlaybackReport{
  kind:PlaybackEventKind;
  itemId:string;
  mediaSourceId:string;
  playSessionId:string|null;
  playMethod:PlaybackMethod;
  positionTicks:number;
  isPaused:boolean;
  isMuted:boolean;
  volumeLevel:number;
  canSeek:boolean;
  failed?:boolean;
}
export type PlaybackContext=Pick<PlaybackReport,
  "itemId"|"mediaSourceId"|"playSessionId"|"playMethod">;
export interface PlaybackClock{
  positionSeconds:number;
  durationSeconds:number;
  paused:boolean;
  muted:boolean;
  volume:number;
  canSeek:boolean;
}
export function playbackTicks(seconds:number):number{
  if(!Number.isFinite(seconds))return 0;
  return Math.max(0,Math.min(864_000_000_000,
    Math.floor(Math.max(0,seconds)*10_000_000)));
}
export function playbackClock(video:HTMLVideoElement):PlaybackClock{
  return {
    positionSeconds:video.currentTime,
    durationSeconds:video.duration,
    paused:video.paused,muted:video.muted,volume:video.volume,
    canSeek:video.seekable?.length>0 || (
      Number.isFinite(video.duration) && video.duration>0)
  };
}
export function reportBody(data:PlaybackReport):Record<string,unknown>{
  const volume=Math.max(0,Math.min(100,
    Math.round(Number.isFinite(data.volumeLevel)?data.volumeLevel:100)));
  const base:Record<string,unknown>={
    ItemId:data.itemId,MediaSourceId:data.mediaSourceId,
    PositionTicks:data.positionTicks
  };
  if(data.playSessionId)base.PlaySessionId=data.playSessionId;
  if(data.kind==="stopped"){
    base.Failed=data.failed===true;
  }else{
    base.PlayMethod=data.playMethod;
    base.CanSeek=data.canSeek;
    base.IsPaused=data.isPaused;
    base.IsMuted=data.isMuted;
    // Jellyfin requires an *integer*. Fractional 57.999... is HTTP 400.
    base.VolumeLevel=volume;
  }
  return base;
}
export function reportPath(kind:PlaybackEventKind):string{
  switch(kind){
    case "start":return "/Sessions/Playing";
    case "progress":return "/Sessions/Playing/Progress";
    case "stopped":return "/Sessions/Playing/Stopped";
  }
}

/** Sequential per-media reporting: PlaybackStart must be acknowledged
 * before Progress/Stopped, and Stopped is emitted at most once.
 * Playback remains possible when reporting is refused or offline. */
export class PlaybackReporter {
  private hasStarted=false;
  private hasStopped=false;
  private lastPeriodicAt=Number.NEGATIVE_INFINITY;
  private sequence=Promise.resolve();
  private failed=false;
  constructor(
    private readonly context:PlaybackContext,
    private readonly write:(event:PlaybackReport)=>Promise<void>,
    private readonly notifyError:()=>void=()=>{},
    private readonly clock:()=>number=()=>Date.now()
  ){}
  private send(kind:PlaybackEventKind,clock:PlaybackClock,
    failed=false):void{
    const report:PlaybackReport={
      ...this.context,kind,
      positionTicks:playbackTicks(clock.positionSeconds),
      isPaused:clock.paused,isMuted:clock.muted,
      volumeLevel:clock.volume*100,
      canSeek:clock.canSeek,failed
    };
    this.sequence=this.sequence.then(async()=>{
      if(this.failed)return;
      try{await this.write(report);}
      catch{
        this.failed=true;
        try{this.notifyError();}catch{/* The media must keep playing. */}
      }
    });
  }
  playing(clock:PlaybackClock):void{
    if(this.hasStopped)return;
    if(!this.hasStarted){
      this.hasStarted=true;this.lastPeriodicAt=this.clock();
      this.send("start",clock);
    }else this.progress(clock,true);
  }
  progress(clock:PlaybackClock,force=false):void{
    if(!this.hasStarted || this.hasStopped || this.failed)return;
    const now=this.clock();
    if(!force && now-this.lastPeriodicAt<15000)return;
    this.lastPeriodicAt=now;
    this.send("progress",clock);
  }
  pause(clock:PlaybackClock):void{
    this.progress({...clock,paused:true},true);
  }
  ended(clock:PlaybackClock):void{
    const position=Number.isFinite(clock.durationSeconds) &&
      clock.durationSeconds>0?clock.durationSeconds:clock.positionSeconds;
    this.stop({...clock,positionSeconds:position},false);
  }
  stop(clock:PlaybackClock,failed=false):void{
    if(this.hasStopped)return;
    this.hasStopped=true;
    // Before the first decoded/playing frame no watch history is written.
    if(this.hasStarted)this.send("stopped",clock,failed);
  }
  get didStart():boolean{return this.hasStarted;}
  async drain():Promise<void>{await this.sequence;}
}
