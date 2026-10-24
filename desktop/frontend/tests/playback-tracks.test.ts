import {describe,expect,it} from "vitest";
import {displayTrack,graphicSubtitleIndex,hasTrack,
  negotiatedAudioIndexMatches,negotiatedGraphicBurnInMatches,
  selectableTracks,supportsGraphicBurnIn,supportsWebVttConversion}
  from "../src/playback-tracks";
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
  it("offers graphics only when the user's source permits transcoding",()=>{
    expect(selectableTracks(source,"Audio").map(t=>t.index)).toEqual([1,2]);
    expect(selectableTracks(source,"Subtitle").map(t=>t.index))
      .toEqual([3,4,5,6,7]);
    expect(supportsWebVttConversion(track("Subtitle",4,"ASS"))).toBe(true);
    expect(supportsWebVttConversion(track("Subtitle",5,"pgssub")))
      .toBe(false);
    expect(hasTrack(source,"Audio",2)).toBe(true);
    expect(hasTrack(source,"Subtitle",5)).toBe(true);
    expect(graphicSubtitleIndex(source,5)).toBe(true);
    expect(graphicSubtitleIndex(source,3)).toBe(false);
    expect(graphicSubtitleIndex({...source,transcoding:false},5)).toBe(false);
    expect(selectableTracks({...source,transcoding:false},"Subtitle")
      .map(t=>t.index)).toEqual([3,4,7]);
    expect(supportsGraphicBurnIn(track("Subtitle",5,"pgssub"))).toBe(true);
    expect(supportsGraphicBurnIn(track("Subtitle",8,"unknown"))).toBe(false);
    expect(displayTrack(source.tracks[6])).toContain("incrustation vidéo");
    expect(hasTrack(null,"Subtitle",3)).toBe(false);
    expect(hasTrack(source,"Audio",-1)).toBe(false);
    expect(hasTrack(source,"Audio",2.5)).toBe(false);
    expect(displayTrack(source.tracks[1])).toContain("Français");
    expect(displayTrack(source.tracks[1])).toContain("par défaut");
  });
  it("accepts only exact server-confirmed graphic burn-in, no fallback",()=>{
    const base="/Videos/"+"a".repeat(32)+"/master.m3u8?"+
      "MediaSourceId="+"b".repeat(32)+
      "&SubtitleStreamIndex=5&SubtitleMethod=Encode";
    expect(negotiatedGraphicBurnInMatches(base,5)).toBe(true);
    expect(negotiatedGraphicBurnInMatches(base,6)).toBe(false);
    expect(negotiatedGraphicBurnInMatches(base.replace(
      "Encode","External"),5)).toBe(false);
    expect(negotiatedGraphicBurnInMatches(base.replace(
      "SubtitleMethod=Encode",""),5)).toBe(false);
    expect(negotiatedGraphicBurnInMatches(base+
      "&SubtitleStreamIndex=5",5)).toBe(false);
    expect(negotiatedGraphicBurnInMatches(base+
      "&SubtitleMethod=Encode",5)).toBe(false);
    expect(negotiatedGraphicBurnInMatches(
      "https://evil.invalid"+base,5)).toBe(false);
    expect(negotiatedGraphicBurnInMatches(
      "/Users/Me?SubtitleStreamIndex=5&SubtitleMethod=Encode",5))
      .toBe(false);
    expect(negotiatedGraphicBurnInMatches(base,-1)).toBe(false);
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
