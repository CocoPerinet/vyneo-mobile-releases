import {describe,it,expect} from "vitest";
import {selectDirectMp4,selectJellyfinHls,validateStreamTicket,resumeAtSeconds} from "../src/native-playback";
import type {PlaybackProbe,PlaybackSource,PlaybackTrack} from "../src/types";
const id="a".repeat(32),ticket="b".repeat(32);
const track=(kind:PlaybackTrack["kind"],codec:string):PlaybackTrack=>({
  kind,index:kind==="Video"?0:1,codec,language:"fra",title:"",
  width:null,height:null,channels:null,isDefault:true,isExternal:false
});
const source=(overrides:Partial<PlaybackSource>={}):PlaybackSource=>({
  id,title:"MP4",container:"MP4",bitrate:12_000_000,
  directPlay:true,directStream:true,transcoding:true,
  tracks:[track("Video","h264"),track("Audio","aac")],...overrides
});
const probe=(s:PlaybackSource[],errorCode:string|null=null):PlaybackProbe=>({
  sources:s,errorCode
});
describe("native playback: no false-positive video compatibility",()=>{
  it("selects only valid Jellyfin-scoped MP4 H.264/AAC sources",()=>{
    expect(selectDirectMp4(probe([source()]))?.id).toBe(id);
    expect(selectDirectMp4(probe([source({container:"m4v"})]))?.id).toBe(id);
    expect(selectDirectMp4(probe([
      source({container:"MKV"}),
      source({tracks:[track("Video","hevc"),track("Audio","aac")]}),
      source({id:"c".repeat(32)})
    ]))?.id).toBe("c".repeat(32));
  });
  it("refuses unsupported codecs, missing sources, denials and malformed ids",()=>{
    for(const different of [
      {container:"MKV"}, {container:"AVI"}, {id:null},
      {directPlay:false}, {tracks:[track("Video","hevc"),track("Audio","aac")]},
      {tracks:[track("Video","h264"),track("Audio","ac3")]},
      {tracks:[track("Video","h264"),track("Audio","dts")]},
      {tracks:[track("Video","h264"),track("Audio","aac"),track("Audio","flac")]},
      {tracks:[track("Audio","aac")]}
    ]){
      expect(selectDirectMp4(probe([source(different)]))).toBeNull();
    }
    expect(selectDirectMp4(probe([]))).toBeNull();
    expect(selectDirectMp4(probe([source()],"NotAllowed"))).toBeNull();
  });
  it("chooses an authorized Jellyfin transcoding source for STRM MKV/HEVC",()=>{
    const hevc=source({container:"MKV",tracks:[
      track("Video","hevc"),track("Audio","eac3")]});
    expect(selectDirectMp4(probe([hevc]))).toBeNull();
    expect(selectJellyfinHls(probe([hevc]))?.id).toBe(id);
    expect(selectJellyfinHls(probe([source({transcoding:false})])))
      .toBeNull();
    expect(selectJellyfinHls(probe([hevc],"NotAllowed")))
      .toBeNull();
  });
  it("resumes at precise Jellyfin ticks, with conservative fallback",()=>{
    expect(resumeAtSeconds({resumeTicks:650_000_000,progress:3},1800))
      .toBe(65);
    expect(resumeAtSeconds({resumeTicks:null,progress:20},1800))
      .toBe(360);
    expect(resumeAtSeconds({resumeTicks:null,progress:99},1800))
      .toBe(0);
    expect(resumeAtSeconds({resumeTicks:17_999_000_000,progress:30},1800))
      .toBe(0);
    expect(resumeAtSeconds({resumeTicks:100_000_000,progress:1},1800))
      .toBe(0);
    expect(resumeAtSeconds({resumeTicks:123_000_000,progress:5},NaN))
      .toBe(0);
  });
  it("accepts only a ticket-scoped local media URL, never a Jellyfin token URL",()=>{
    expect(validateStreamTicket({
      ticket,url:"http://vyneo-media.localhost/stream/"+ticket
    })).toEqual({ticket,url:"http://vyneo-media.localhost/stream/"+ticket});
    expect(validateStreamTicket({
      ticket,url:"vyneo-media://localhost/stream/"+ticket
    }).ticket).toBe(ticket);
    expect(validateStreamTicket({
      ticket,url:"http://vyneo-media.localhost/hls/"+ticket+"/index.m3u8"
    }).ticket).toBe(ticket);
    expect(validateStreamTicket({
      ticket,url:"vyneo-media://localhost/hls/"+ticket+"/index.m3u8"
    }).ticket).toBe(ticket);
    for(const url of [
      "https://cocojellyfin.duckdns.org/Videos/id?api_key=x",
      "http://evil.example/stream/"+ticket,
      "http://vyneo-media.localhost/stream/"+ticket+"?token=SECRET",
      "http://vyneo-media.localhost/stream/"+id,
      "http://127.0.0.1/stream/"+ticket
    ]){
      expect(()=>validateStreamTicket({ticket,url}))
        .toThrow("STREAM_RESPONSE_INVALID");
    }
  });
});
