import {parsePlaybackInfo} from "./media-details";
import type {PlaybackProbe} from "./types";

// Keep in sync with api.ts; both clients must reject alternate servers.
const SERVER_ORIGIN="https://cocojellyfin.duckdns.org:38443";

const GUID=/^[0-9a-f]{32}$/i;
/** WebView2 can play MP4/AVC, and hls.js can remux HLS/TS H.264/AAC.
 * Do not advertise HEVC, E-AC3 or subtitle support before real validation. */
export const WEBVIEW2_DEVICE_PROFILE={
  Name:"Vyneo WebView2",
  MaxStreamingBitrate:8_192_000,
  MaxStaticBitrate:80_000_000,
  DirectPlayProfiles:[{
    Container:"mp4,m4v",VideoCodec:"h264",AudioCodec:"aac,mp3",Type:"Video"
  }],
  TranscodingProfiles:[{
    Container:"ts",Protocol:"hls",VideoCodec:"h264",AudioCodec:"aac",
    Context:"Streaming",Type:"Video",MaxAudioChannels:"2",
    MinSegments:2,SegmentLength:6
  }],
  SubtitleProfiles:[]
} as const;
export const NEGOTIATED_MAX_BITRATE=8_192_000;

/** The server's negotiated TranscodingUrl is a playback contract.
 * Strip all credential-bearing query parameters in memory and pass only a
 * vetted relative URL to Rust, never to the renderer's video element. */
export function safeHlsPath(input:unknown,itemId:string,
  mediaSourceId:string,playSessionId:string|null):string|null{
  if(typeof input!=="string" || input.length>6000 ||
    !GUID.test(itemId) || !GUID.test(mediaSourceId) ||
    !input.startsWith("/") || input.startsWith("//") ||
    input.includes("\\") || /[\u0000-\u001F\u007F]/.test(input))
    return null;
  let url:URL;
  try{url=new URL(input,SERVER_ORIGIN);}
  catch{return null;}
  if(url.origin!==SERVER_ORIGIN || url.username || url.password ||
    url.hash || url.search.length>4600)return null;
  const found=/^\/videos\/([0-9a-f-]{32,36})\/master\.m3u8$/i.exec(
    url.pathname);
  if(!found || found[1].replaceAll("-","").toLowerCase()!==
    itemId.toLowerCase())return null;
  const clean=new URLSearchParams();
  let count=0;
  for(const [key,value] of url.searchParams){
    count++;
    if(count>70 || key.length>64 || !/^[a-z0-9_-]+$/i.test(key) ||
      value.length>384 || /[\u0000-\u001F\u007F]/.test(value))
      return null;
    if(/(?:api[-_]?key|access[-_]?token|x[-_]?emby[-_]?token|bearer|password|secret|authorization|credential)/i.test(key))
      continue;
    clean.append(key,value);
  }
  const source=clean.get("MediaSourceId")??
    [...clean.entries()].find(([key])=>key.toLowerCase()==="mediasourceid")?.[1];
  const get=(field:string)=>[...clean.entries()].find(([k])=>
    k.toLowerCase()===field)?.[1]??"";
  if(!source || source.replaceAll("-","").toLowerCase()!==
    mediaSourceId.toLowerCase() ||
    get("videocodec").toLowerCase()!=="h264" ||
    !get("audiocodec").toLowerCase().split(",").includes("aac") ||
    get("segmentcontainer").toLowerCase()!=="ts" ||
    (playSessionId && get("playsessionid").toLowerCase()!==
      playSessionId.toLowerCase()))
    return null;
  const result=url.pathname+"?"+clean.toString();
  return result.length<=5000?result:null;
}
export interface NegotiatedPlayback {
  probe:PlaybackProbe;
  /** Paths vetted against the server origin and the selected media IDs. */
  hlsPaths:Record<string,string>;
}
export function parseNegotiatedPlayback(payload:unknown,
  itemId:string):NegotiatedPlayback{
  const probe=parsePlaybackInfo(payload);
  const hlsPaths:Record<string,string>=Object.create(null);
  const raw=payload && typeof payload==="object" && !Array.isArray(payload)
    ?payload as Record<string,unknown>:{};
  const sources=Array.isArray(raw.MediaSources)?raw.MediaSources:[];
  for(const source of sources.slice(0,8)){
    if(!source || typeof source!=="object" || Array.isArray(source))continue;
    const row=source as Record<string,unknown>;
    const id=typeof row.Id==="string"?row.Id:"";
    if(!GUID.test(id) || row.SupportsTranscoding!==true)continue;
    const path=safeHlsPath(row.TranscodingUrl,itemId,id,
      probe.playSessionId??null);
    if(path)hlsPaths[id]=path;
  }
  return {probe,hlsPaths};
}
