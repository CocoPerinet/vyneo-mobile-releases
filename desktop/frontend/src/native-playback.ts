import type {MediaItem,PlaybackProbe,PlaybackSource} from "./types";

/** Deliberately conservative: WebView2's MP4 path can support AVC + AAC.
 * Non-MP4, HEVC, AC-3/DTS, HLS and burn-in subtitles require negotiation.
 * A Jellyfin "supports direct play" claim alone is not a codec guarantee. */
export function selectDirectMp4(probe:PlaybackProbe):PlaybackSource|null{
  if(probe.errorCode)return null;
  return probe.sources.find(source=>{
    if(!source.id || !source.directPlay ||
      !["MP4","M4V"].includes(source.container.toUpperCase()))return false;
    const video=source.tracks.filter(track=>track.kind==="Video");
    const audio=source.tracks.filter(track=>track.kind==="Audio");
    return video.length===1 &&
      ["h264","avc"].includes(video[0].codec.toLowerCase()) &&
      audio.every(track=>["aac","mp3"].includes(track.codec.toLowerCase()));
  })??null;
}
export type NativeStreamTicket={
  ticket:string;
  url:string;
};
const TICKET=/^[a-f0-9]{32}$/i;
const ISOLATED_SCHEMES=[
  "http://vyneo-media.localhost/stream/",
  "vyneo-media://localhost/stream/"
];
export function validateStreamTicket(value:unknown):NativeStreamTicket{
  if(!value || typeof value!=="object" || Array.isArray(value))
    throw new Error("STREAM_RESPONSE_INVALID");
  const row=value as Record<string,unknown>;
  if(typeof row.ticket!=="string" || !TICKET.test(row.ticket) ||
     typeof row.url!=="string" ||
     !ISOLATED_SCHEMES.some(prefix=>row.url===prefix+row.ticket))
    throw new Error("STREAM_RESPONSE_INVALID");
  return {ticket:row.ticket,url:row.url};
}

/** Exact Jellyfin ticks take priority over lossy whole-percent progress.
 * Avoid unexpected jumps into the final seconds of a finished episode. */
export function resumeAtSeconds(item:Pick<MediaItem,
  "resumeTicks"|"progress">,duration:number):number{
  if(!Number.isFinite(duration) || duration<45)return 0;
  const ticks=item.resumeTicks;
  const seconds=typeof ticks==="number" && Number.isSafeInteger(ticks) &&
    ticks>0?ticks/10_000_000:
    typeof item.progress==="number" && Number.isFinite(item.progress) &&
    item.progress>0 && item.progress<95
      ?duration*item.progress/100:0;
  if(!Number.isFinite(seconds) || seconds<15 ||
    seconds>duration-20)return 0;
  return Math.floor(seconds);
}
