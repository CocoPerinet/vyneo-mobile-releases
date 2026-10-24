import type {PlaybackSource,PlaybackTrack} from "./types";

const TEXT_SUBTITLES=new Set([
  "srt","subrip","vtt","webvtt","ass","ssa","ttml"
]);
// Opt-in only. Pixel subtitle formats cannot be represented as HTML tracks.
// The Jellyfin server must confirm the selected stream is burned into HLS.
const GRAPHIC_SUBTITLES=new Set([
  "pgs","pgssub","dvdsub","dvbsub","idx"
]);

/** Only text subtitle codecs Jellyfin can reasonably export as WebVTT.
 * Graphical subtitles (PGS, DVD, DVB) need a separate server burn-in path.
 */
export function supportsWebVttConversion(track:PlaybackTrack):boolean {
  return track.kind==="Subtitle" &&
    TEXT_SUBTITLES.has(track.codec.toLowerCase());
}
export function supportsGraphicBurnIn(track:PlaybackTrack):boolean{
  return track.kind==="Subtitle" &&
    GRAPHIC_SUBTITLES.has(track.codec.toLowerCase());
}
export function graphicSubtitleIndex(
  source:PlaybackSource|null,index:number|null
):boolean{
  return index!==null && source!==null &&
    source.transcoding===true &&
    selectableTracks(source,"Subtitle").some(track=>
      track.index===index && supportsGraphicBurnIn(track));
}
export function selectableTracks(
  source:PlaybackSource|null,kind:"Audio"|"Subtitle"
):PlaybackTrack[]{
  if(!source)return [];
  const seen=new Set<number>();
  return source.tracks.filter(track=>{
    if(track.kind!==kind || seen.has(track.index))return false;
    seen.add(track.index);
    return kind==="Audio" || supportsWebVttConversion(track) ||
      (source.transcoding && supportsGraphicBurnIn(track));
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
    (track.isDefault?" · par défaut":"")+
    (supportsGraphicBurnIn(track)?" · incrustation vidéo":"");
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

/** Server-selected image subtitles are safe only when Jellyfin promises
 * an actual Encode method for the EXACT requested stream. A missing or
 * duplicated query key must fail closed instead of playing a wrong track.
 */
export function negotiatedGraphicBurnInMatches(
  tokenFreePath:string,requestedIndex:number
):boolean{
  if(!Number.isSafeInteger(requestedIndex) ||
    requestedIndex<0 || requestedIndex>10000 ||
    typeof tokenFreePath!=="string" || tokenFreePath.length>5000)
    return false;
  try{
    const url=new URL(tokenFreePath,"https://cocojellyfin.duckdns.org:38443");
    if(url.origin!=="https://cocojellyfin.duckdns.org:38443" ||
       !/^\/Videos\/[a-f0-9-]{32,36}\/master\.m3u8$/i.test(url.pathname))
      return false;
    const params=(name:string)=>[...url.searchParams.entries()]
      .filter(([key])=>key.toLowerCase()===name.toLowerCase())
      .map(([,value])=>value);
    const indices=params("SubtitleStreamIndex");
    const methods=params("SubtitleMethod");
    return indices.length===1 && indices[0]===String(requestedIndex) &&
      methods.length===1 && methods[0].toLowerCase()==="encode";
  }catch{return false;}
}
