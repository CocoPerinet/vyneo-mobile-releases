import type {PlaybackSource,PlaybackTrack} from "./types";

const TEXT_SUBTITLES=new Set([
  "srt","subrip","vtt","webvtt","ass","ssa","ttml"
]);

/** Only text subtitle codecs Jellyfin can reasonably export as WebVTT.
 * Graphical subtitles (PGS, DVD, DVB) need a separate server burn-in path.
 */
export function supportsWebVttConversion(track:PlaybackTrack):boolean {
  return track.kind==="Subtitle" &&
    TEXT_SUBTITLES.has(track.codec.toLowerCase());
}
export function selectableTracks(
  source:PlaybackSource|null,kind:"Audio"|"Subtitle"
):PlaybackTrack[]{
  if(!source)return [];
  const seen=new Set<number>();
  return source.tracks.filter(track=>{
    if(track.kind!==kind || seen.has(track.index))return false;
    seen.add(track.index);
    return kind==="Audio" || supportsWebVttConversion(track);
  });
}
export function hasTrack(
  source:PlaybackSource|null,kind:"Audio"|"Subtitle",index:number
):boolean {
  return Number.isSafeInteger(index) && index>=0 && index<=10000 &&
    selectableTracks(source,kind).some(track=>track.index===index);
}
export function displayTrack(track:PlaybackTrack):string {
  const label=track.title.trim() ||
    [track.language,track.codec.toUpperCase()].filter(Boolean).join(" · ") ||
    "Piste "+track.index;
  return label.slice(0,180)+
    (track.isDefault?" · par défaut":"");
}
/** A manually selected audio index MUST be present in the vetted,
 * token-free Jellyfin transcode URL. Otherwise do not silently play the
 * wrong language. No identity or secrets are returned in errors.
 */
export function negotiatedAudioIndexMatches(
  tokenFreePath:string,requestedIndex:number
):boolean {
  if(!Number.isSafeInteger(requestedIndex) ||
    requestedIndex<0 || requestedIndex>10000 ||
    typeof tokenFreePath!=="string" || tokenFreePath.length>5000)
    return false;
  try{
    const url=new URL(tokenFreePath,"https://cocojellyfin.duckdns.org:38443");
    if(url.origin!=="https://cocojellyfin.duckdns.org:38443" ||
       !/^\/Videos\/[a-f0-9-]{32,36}\/master\.m3u8$/i.test(url.pathname))
      return false;
    const values=[...url.searchParams.entries()].filter(([k])=>
      k.toLowerCase()==="audiostreamindex");
    return values.length===1 && values[0][1]===String(requestedIndex);
  }catch{return false;}
}
