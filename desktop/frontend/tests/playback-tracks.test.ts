import {describe,expect,it} from "vitest";
import {displayTrack,hasTrack,negotiatedAudioIndexMatches,
  selectableTracks,supportsWebVttConversion} from "../src/playback-tracks";
import type {PlaybackSource,PlaybackTrack} from "../src/types";

const track=(kind:PlaybackTrack["kind"],index:number,codec:string,
  extra:Partial<PlaybackTrack>={}):PlaybackTrack=>({
    kind,index,codec,language:"fra",title:"",
    width:null,height:null,channels:null,isDefault:false,isExternal:false,
    ...extra
  });
const source:PlaybackSource={
  id:"a".repeat(32),title:"Remote STRM",container:"MKV",
  bitrate:5000000,runtimeTicks:null,directPlay:false,directStream:true,
  transcoding:true,isRemote:true,tracks:[
    track("Video",0,"hevc"),
    track("Audio",1,"aac",{isDefault:true,title:"Français"}),
    track("Audio",2,"eac3",{title:"Anglais"}),
    track("Audio",2,"eac3",{title:"Duplicate"}),
    track("Subtitle",3,"subrip",{title:"Français forcé"}),
    track("Subtitle",4,"ass"),
    track("Subtitle",5,"pgssub"),
    track("Subtitle",6,"dvdsub"),
    track("Subtitle",7,"vtt")
  ]
};
describe("audio and subtitle selection from verified Jellyfin media streams",()=>{
  it("lists audio streams without duplicates and exposes text-only subtitles",()=>{
    expect(selectableTracks(source,"Audio").map(t=>t.index)).toEqual([1,2]);
    expect(selectableTracks(source,"Subtitle").map(t=>t.index))
      .toEqual([3,4,7]);
    expect(supportsWebVttConversion(track("Subtitle",4,"ASS"))).toBe(true);
    expect(supportsWebVttConversion(track("Subtitle",5,"pgssub")))
      .toBe(false);
    expect(hasTrack(source,"Audio",2)).toBe(true);
    expect(hasTrack(source,"Subtitle",5)).toBe(false);
    expect(hasTrack(null,"Subtitle",3)).toBe(false);
    expect(hasTrack(source,"Audio",-1)).toBe(false);
    expect(hasTrack(source,"Audio",2.5)).toBe(false);
    expect(displayTrack(source.tracks[1])).toContain("Français");
    expect(displayTrack(source.tracks[1])).toContain("par défaut");
  });
  it("rejects an HLS URL if the selected audio is not in its token-free query",()=>{
    const base="/Videos/"+"a".repeat(32)+"/master.m3u8?"+
      "MediaSourceId="+"b".repeat(32)+"&AudioStreamIndex=2";
    expect(negotiatedAudioIndexMatches(base,2)).toBe(true);
    expect(negotiatedAudioIndexMatches(base,1)).toBe(false);
    expect(negotiatedAudioIndexMatches(base+"&AudioStreamIndex=2",2))
      .toBe(false);
    expect(negotiatedAudioIndexMatches(base.replace("2","evil"),2))
      .toBe(false);
    expect(negotiatedAudioIndexMatches("https://evil.example"+base,2))
      .toBe(false);
    expect(negotiatedAudioIndexMatches("/Users/Me?AudioStreamIndex=2",2))
      .toBe(false);
    expect(negotiatedAudioIndexMatches(base,10001)).toBe(false);
  });
});
