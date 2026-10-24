import type {PlaybackProbe,PlaybackSource,PlaybackTrack,SeasonSummary} from "./types";

const ID=/^[a-f0-9]{32}$/i;
const object=(value:unknown):Record<string,unknown>=>
  value!==null && typeof value==="object" && !Array.isArray(value)
    ?value as Record<string,unknown>:{};
const text=(value:unknown,max=120)=>
  typeof value==="string"?value.replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,max):"";
const whole=(value:unknown,min=0,max=1_000_000_000):number|null=>
  typeof value==="number" && Number.isSafeInteger(value) &&
  value>=min && value<=max?value:null;

export function parseSeasons(payload:unknown):SeasonSummary[]{
  const raw=object(payload).Items;
  if(!Array.isArray(raw))throw new Error("SEASONS_INVALID");
  const used=new Set<string>(),items:SeasonSummary[]=[];
  for(const value of raw.slice(0,80)){
    const row=object(value);
    if(typeof row.Id!=="string" || !ID.test(row.Id) ||
       used.has(row.Id.toLowerCase()))continue;
    used.add(row.Id.toLowerCase());
    const number=whole(row.IndexNumber,0,1000);
    items.push({
      id:row.Id,
      title:text(row.Name,140)||(
        number===0?"Épisodes spéciaux":
        number===null?"Saison":"Saison "+number),
      number,
      episodeCount:whole(row.RecursiveItemCount??row.ChildCount,0,100000),
      unplayedCount:whole(object(row.UserData).UnplayedItemCount,0,100000)
    });
  }
  return items.sort((a,b)=>(a.number??Number.MAX_SAFE_INTEGER)-
    (b.number??Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title));
}
export function parsePlaybackInfo(payload:unknown):PlaybackProbe{
  const root=object(payload),raw=root.MediaSources;
  if(!Array.isArray(raw))throw new Error("PLAYBACK_INFO_INVALID");
  const sources:PlaybackSource[]=[];
  for(const value of raw.slice(0,8)){
    const row=object(value);
    const streams=Array.isArray(row.MediaStreams)?row.MediaStreams:[];
    const tracks:PlaybackTrack[]=[];
    for(const entry of streams.slice(0,48)){
      const stream=object(entry),kind=stream.Type;
      if(kind!=="Video" && kind!=="Audio" && kind!=="Subtitle")continue;
      const index=whole(stream.Index,0,10000);
      if(index===null)continue;
      tracks.push({
        kind,index,codec:text(stream.Codec,32),
        language:text(stream.Language,32),
        title:text(stream.DisplayTitle??stream.Title,150),
        width:whole(stream.Width,1,16384),
        height:whole(stream.Height,1,16384),
        channels:whole(stream.Channels,1,64),
        isDefault:stream.IsDefault===true,
        isExternal:stream.IsExternal===true
      });
    }
    sources.push({
      id:typeof row.Id==="string" && ID.test(row.Id)?row.Id:null,
      title:text(row.Name,120)||"Source vidéo",
      container:text(row.Container,40).toUpperCase(),
      bitrate:whole(row.Bitrate,1,1_000_000_000),
      runtimeTicks:whole(row.RunTimeTicks,1,864_000_000_000),
      directPlay:row.SupportsDirectPlay===true,
      directStream:row.SupportsDirectStream===true,
      transcoding:row.SupportsTranscoding===true,
      isRemote:row.IsRemote===true,
      tracks
    });
  }
  const allowed=new Set(["NotAllowed","NoCompatibleStream","RateLimitExceeded"]);
  const error=text(root.ErrorCode,40);
  return {sources,errorCode:allowed.has(error)?error:null,
    playSessionId:typeof root.PlaySessionId==="string" &&
      ID.test(root.PlaySessionId)?root.PlaySessionId:null};
}
