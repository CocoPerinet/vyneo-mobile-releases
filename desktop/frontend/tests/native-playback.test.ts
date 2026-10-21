import {describe,it,expect} from "vitest";
import {selectDirectMp4,validateStreamTicket} from "../src/native-playback";
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
  it("accepts only a ticket-scoped local media URL, never a Jellyfin token URL",()=>{
    expect(validateStreamTicket({
      ticket,url:"http://vyneo-media.localhost/stream/"+ticket
    })).toEqual({ticket,url:"http://vyneo-media.localhost/stream/"+ticket});
    expect(validateStreamTicket({
      ticket,url:"vyneo-media://localhost/stream/"+ticket
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
