import {describe,it,expect,vi} from "vitest";
import {JellyfinApi,SERVER_ORIGIN} from "../src/api";
import {parseNegotiatedPlayback,safeHlsPath,
  WEBVIEW2_DEVICE_PROFILE} from "../src/playback-negotiation";
const ITEM="a".repeat(32),SOURCE="b".repeat(32),
  SESSION="c".repeat(32),USER="d".repeat(32),
  TOKEN="e".repeat(64),OTHER="f".repeat(32);
const url="/videos/"+ITEM+"/master.m3u8?DeviceId=desktop-qa"+
  "&MediaSourceId="+SOURCE+"&VideoCodec=h264&AudioCodec=aac%2Cmp3"+
  "&VideoBitrate=7600000&SegmentContainer=ts&MinSegments=2"+
  "&PlaySessionId="+SESSION+"&Tag=987abc&ApiKey=private-secret";

const sample=(override:Record<string,unknown>={})=>({
  PlaySessionId:SESSION,MediaSources:[{
    Id:SOURCE,Type:"Default",Container:"mkv",
    SupportsDirectPlay:false,SupportsDirectStream:true,
    SupportsTranscoding:true,TranscodingSubProtocol:"hls",
    TranscodingUrl:url,
    MediaStreams:[{Type:"Video",Index:0,Codec:"hevc"},
      {Type:"Audio",Index:1,Codec:"eac3"}],
    ...override
  }]
});
describe("negotiated Jellyfin HLS is tokenless and constrained",()=>{
  it("uses exactly the Jellyfin transcode path, retaining its session/profile",()=>{
    const result=parseNegotiatedPlayback(sample(),ITEM);
    expect(result.probe.playSessionId).toBe(SESSION);
    expect(result.probe.sources[0].id).toBe(SOURCE);
    const cleaned=result.hlsPaths[SOURCE];
    expect(cleaned).toContain("master.m3u8");
    expect(cleaned).toContain("PlaySessionId="+SESSION);
    expect(cleaned).toContain("Tag=987abc");
    expect(cleaned).toContain("VideoBitrate=7600000");
    expect(cleaned).toContain("AudioCodec=aac%2Cmp3");
    expect(cleaned).not.toMatch(/ApiKey|api_key|private-secret/i);
    expect(JSON.stringify(result)).not.toContain("private-secret");
  });
  it("rejects transcode URLs belonging to another server/item/source/session",()=>{
    const cases=[
      "https://evil.example"+url,
      "//evil.example"+url,
      url.replace(ITEM,OTHER),
      url.replace(SOURCE,OTHER),
      url.replace(SESSION,OTHER),
      url.replace("master.m3u8","main.m3u8"),
      url.replace("VideoCodec=h264","VideoCodec=hevc"),
      url.replace("AudioCodec=aac%2Cmp3","AudioCodec=ac3"),
      url.replace("SegmentContainer=ts","SegmentContainer=mp4"),
      url+"#fragment",
      url+"&Authorization=SECRET",
      url.replace("master.m3u8","../../Users/Me"),
    ];
    cases.forEach((unsafe)=>{
      const normalized=safeHlsPath(unsafe,ITEM,SOURCE,SESSION);
      if(unsafe.includes("Authorization=SECRET")){
        expect(normalized).not.toContain("SECRET");
      }else{
        expect(normalized).toBeNull();
      }
    });
    expect(safeHlsPath(null,ITEM,SOURCE,SESSION)).toBeNull();
    expect(safeHlsPath(url,"../bad",SOURCE,SESSION)).toBeNull();
  });
  it("refuses untrusted or unplayable negotiated sources",()=>{
    expect(Object.keys(parseNegotiatedPlayback(
      sample({SupportsTranscoding:false,SupportsDirectStream:true}),ITEM)
      .hlsPaths)).toEqual([SOURCE]);
    expect(Object.keys(parseNegotiatedPlayback(
      sample({SupportsTranscoding:false,SupportsDirectStream:false}),ITEM)
      .hlsPaths)).toHaveLength(0);
    expect(Object.keys(parseNegotiatedPlayback(
      sample({Id:OTHER,TranscodingUrl:url}),ITEM).hlsPaths)).toHaveLength(0);
    expect(Object.keys(parseNegotiatedPlayback(
      sample({TranscodingUrl:"javascript:alert(1)"}),ITEM).hlsPaths))
      .toHaveLength(0);
  });
  it("POSTs a strict WebView2 device profile only when starting playback",async()=>{
    const requests:Array<{url:URL,options:RequestInit}>=[];
    const fetcher=vi.fn(async(req:RequestInfo|URL,
      options:RequestInit={})=>{
      const address=new URL(String(req));
      requests.push({url:address,options});
      if(address.pathname==="/Users/AuthenticateByName")
        return new Response(JSON.stringify({
          User:{Id:USER,Name:"QA"},AccessToken:TOKEN
        }),{headers:{"Content-Type":"application/json"}});
      if(address.pathname==="/Users/Me")
        return new Response(JSON.stringify({
          Id:USER,Name:"QA",Policy:{IsDisabled:false}
        }),{headers:{"Content-Type":"application/json"}});
      if(address.pathname==="/Items/"+ITEM+"/PlaybackInfo")
        return new Response(JSON.stringify(sample()),
          {headers:{"Content-Type":"application/json"}});
      throw new Error("unexpected path");
    }) as typeof fetch;
    const api=new JellyfinApi({fetcher,deviceId:"qa-device"});
    await api.login("QA","fixture-only");
    const before=requests.length;
    expect(before).toBe(2);
    const negotiation=await api.negotiatePlaybackInfo(ITEM);
    expect(negotiation.probe.sources).toHaveLength(1);
    expect(negotiation.hlsPaths[SOURCE]).not.toContain("ApiKey");
    expect(requests).toHaveLength(3);
    const {url:request,options}=requests.at(-1)!;
    expect(request.origin).toBe(SERVER_ORIGIN);
    expect(request.pathname).toBe("/Items/"+ITEM+"/PlaybackInfo");
    expect(request.search).toBe("");
    expect(options.method).toBe("POST");
    expect(options.credentials).toBe("omit");
    expect(options.redirect).toBe("error");
    expect((options.headers as Record<string,string>).Authorization)
      .toContain(TOKEN);
    const body=JSON.parse(String(options.body));
    expect(body.UserId).toBe(USER);
    expect(body.DeviceProfile).toEqual(WEBVIEW2_DEVICE_PROFILE);
    expect(body.EnableTranscoding).toBe(true);
    expect(body.MaxAudioChannels).toBe(2);
    expect(body.DeviceProfile.TranscodingProfiles[0]).toMatchObject({
      Container:"ts",Protocol:"hls",VideoCodec:"h264",AudioCodec:"aac"
    });
    expect(request.href).not.toContain(TOKEN);
    api.logout();
    await expect(api.negotiatePlaybackInfo(ITEM))
      .rejects.toThrow("AUTH_REQUIRED");
  });
});
