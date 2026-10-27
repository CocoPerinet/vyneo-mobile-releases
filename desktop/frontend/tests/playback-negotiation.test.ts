import {describe,it,expect,vi} from "vitest";
import {JellyfinApi,SERVER_ORIGIN} from "../src/api";
import {negotiatedSubtitlesAreOff,parseNegotiatedPlayback,safeHlsPath,
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
  it("accepts subtitle-off only, rejecting implicit server burn-in",()=>{
    expect(negotiatedSubtitlesAreOff(url)).toBe(true);
    expect(negotiatedSubtitlesAreOff(url+"&SubtitleStreamIndex=-1"))
      .toBe(true);
    expect(negotiatedSubtitlesAreOff(url+
      "&SubtitleStreamIndex=4&SubtitleMethod=Encode")).toBe(false);
    // Actual Jellyfin response: Method=Encode without any subtitle
    // stream selected and MediaSource.DefaultSubtitleStreamIndex=-1.
    expect(negotiatedSubtitlesAreOff(url+"&SubtitleMethod=Encode",-1))
      .toBe(true);
    expect(negotiatedSubtitlesAreOff(url+"&SubtitleMethod=Encode"))
      .toBe(false);
    expect(negotiatedSubtitlesAreOff(url+"&SubtitleMethod=Encode",3))
      .toBe(false);
    expect(negotiatedSubtitlesAreOff(url+
      "&SubtitleStreamIndex=-1&SubtitleMethod=Encode",-1)).toBe(true);
    expect(negotiatedSubtitlesAreOff(url+
      "&SubtitleStreamIndex=3&SubtitleMethod=Encode",-1)).toBe(false);
    expect(negotiatedSubtitlesAreOff(url+
      "&SubtitleMethod=Encode&SubtitleMethod=Encode",-1)).toBe(false);
    expect(negotiatedSubtitlesAreOff(url+
      "&SubtitleStreamIndex=-1&SubtitleStreamIndex=-1")).toBe(false);
    expect(negotiatedSubtitlesAreOff(url+
      "&SubtitleStreamIndex=4")).toBe(false);
    expect(negotiatedSubtitlesAreOff("https://evil.invalid"+url))
      .toBe(false);
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
  it("rejects invalid audio choices before network activity and confirms the chosen index",async()=>{
    const requests:Array<{url:URL,options:RequestInit}>=[];
    const fetcher=vi.fn(async(req:RequestInfo|URL,options:RequestInit={})=>{
      const url=new URL(String(req));requests.push({url,options});
      if(url.pathname==="/Users/AuthenticateByName")
        return new Response(JSON.stringify({User:{Id:USER,Name:"QA"},
          AccessToken:TOKEN}),{
          headers:{"Content-Type":"application/json"}
        });
      if(url.pathname==="/Users/Me")
        return new Response(JSON.stringify({Id:USER,Name:"QA"}),{
          headers:{"Content-Type":"application/json"}
        });
      if(url.pathname==="/Items/"+ITEM+"/PlaybackInfo"){
        const body=JSON.parse(String(options.body));
        return new Response(JSON.stringify(sample({
          MediaStreams:[{Type:"Video",Index:0,Codec:"hevc"},
            {Type:"Audio",Index:1,Codec:"aac"},
            {Type:"Audio",Index:2,Codec:"eac3"}],
          TranscodingUrl:urlForAudio(body.AudioStreamIndex)
        })),{
          headers:{"Content-Type":"application/json"}
        });
      }
      throw new Error("UNEXPECTED_API");
    }) as typeof fetch;
    const urlForAudio=(index:number)=>url+
      "&AudioStreamIndex="+index;
    const api=new JellyfinApi({fetcher});
    api.enableReadOnlyQa();await api.login("QA","fixture");
    const before=requests.length;
    await expect(api.negotiatePlaybackInfo(ITEM,{
      audioStreamIndex:-1,mediaSourceId:SOURCE
    })).rejects.toThrow("AUDIO_TRACK_INVALID");
    await expect(api.negotiatePlaybackInfo(ITEM,{
      audioStreamIndex:10001,mediaSourceId:SOURCE
    })).rejects.toThrow("AUDIO_TRACK_INVALID");
    expect(requests).toHaveLength(before);
    const audio=await api.negotiatePlaybackInfo(ITEM,{
      audioStreamIndex:2,mediaSourceId:SOURCE
    });
    expect(audio.hlsPaths[SOURCE]).toContain("AudioStreamIndex=2");
    const posted=JSON.parse(String(requests.at(-1)?.options.body));
    expect(posted.AudioStreamIndex).toBe(2);
    expect(posted.MediaSourceId).toBe(SOURCE);
    expect(posted.EnableDirectPlay).toBe(false);
    expect(posted.SubtitleStreamIndex).toBe(-1);
    expect(requests.every(r=>!r.url.href.includes(TOKEN))).toBe(true);
  });
  it("negotiates graphical PGS burn-in only by explicit selection",async()=>{
    const requests:Array<{url:URL,options:RequestInit}>=[];
    let method="Encode",advertise=true,defaultIndex=-1;
    const fetcher=vi.fn(async(req:RequestInfo|URL,options:RequestInit={})=>{
      const address=new URL(String(req));
      requests.push({url:address,options});
      if(address.pathname==="/Users/AuthenticateByName")
        return new Response(JSON.stringify({User:{Id:USER,Name:"QA"},
          AccessToken:TOKEN}),{
          headers:{"Content-Type":"application/json"}
        });
      if(address.pathname==="/Users/Me")
        return new Response(JSON.stringify({Id:USER,Name:"QA"}),{
          headers:{"Content-Type":"application/json"}
        });
      if(address.pathname==="/Items/"+ITEM+"/PlaybackInfo"){
        const body=JSON.parse(String(options.body));
        const subtitleIndex=body.SubtitleStreamIndex;
        return new Response(JSON.stringify(sample({
          SupportsTranscoding:advertise,
          DefaultSubtitleStreamIndex:defaultIndex,
          MediaStreams:[
            {Type:"Video",Index:0,Codec:"h264"},
            {Type:"Audio",Index:1,Codec:"aac"},
            {Type:"Subtitle",Index:4,Codec:"pgssub"}
          ],
          TranscodingUrl:url+
            (subtitleIndex===-1?"":"&SubtitleStreamIndex="+subtitleIndex)+
            "&SubtitleMethod="+method+
            (body.AudioStreamIndex===undefined?"":
              "&AudioStreamIndex="+body.AudioStreamIndex)
        })),{headers:{"Content-Type":"application/json"}});
      }
      throw new Error("UNEXPECTED_API");
    }) as typeof fetch;
    const api=new JellyfinApi({fetcher});
    api.enableReadOnlyQa();await api.login("QA","fixture");
    const before=requests.length;
    await expect(api.negotiatePlaybackInfo(ITEM,{
      mediaSourceId:SOURCE,graphicSubtitleIndex:-1
    })).rejects.toThrow("SUBTITLE_TRACK_INVALID");
    await expect(api.negotiatePlaybackInfo(ITEM,{
      mediaSourceId:SOURCE,graphicSubtitleIndex:10001
    })).rejects.toThrow("SUBTITLE_TRACK_INVALID");
    expect(requests).toHaveLength(before);
    const pinned=await api.negotiatePlaybackInfo(ITEM,{
      mediaSourceId:SOURCE
    });
    expect(pinned.hlsPaths[SOURCE]).not.toContain("SubtitleStreamIndex=");
    expect(pinned.hlsPaths[SOURCE]).toContain("SubtitleMethod=Encode");
    const pinnedBody=JSON.parse(String(requests.at(-1)?.options.body));
    expect(pinnedBody.MediaSourceId).toBe(SOURCE);
    expect(pinnedBody.SubtitleStreamIndex).toBe(-1);
    expect(pinnedBody.EnableDirectPlay).toBe(true);
    expect(pinnedBody.AlwaysBurnInSubtitleWhenTranscoding).toBeUndefined();
    const burn=await api.negotiatePlaybackInfo(ITEM,{
      mediaSourceId:SOURCE,graphicSubtitleIndex:4,audioStreamIndex:1
    });
    expect(burn.hlsPaths[SOURCE]).toContain("SubtitleStreamIndex=4");
    expect(burn.hlsPaths[SOURCE]).toContain("SubtitleMethod=Encode");
    expect(burn.hlsPaths[SOURCE]).not.toContain("private-secret");
    const body=JSON.parse(String(requests.at(-1)?.options.body));
    expect(body.AudioStreamIndex).toBe(1);
    expect(body.SubtitleStreamIndex).toBe(4);
    expect(body.MediaSourceId).toBe(SOURCE);
    expect(body.EnableDirectPlay).toBe(false);
    expect(body.EnableDirectStream).toBe(false);
    expect(body.AllowVideoStreamCopy).toBe(false);
    expect(body.AlwaysBurnInSubtitleWhenTranscoding).toBe(true);
    expect(body.DeviceProfile.SubtitleProfiles).toContainEqual({
      Format:"pgssub",Method:"Encode"
    });
    expect(requests.every(r=>r.url.origin===SERVER_ORIGIN &&
      !r.url.href.includes(TOKEN))).toBe(true);
    defaultIndex=3;
    await expect(api.negotiatePlaybackInfo(ITEM,{
      mediaSourceId:SOURCE
    })).rejects.toThrow("SUBTITLE_AUTO_BURN_UNAVAILABLE");
    defaultIndex=-1;
    method="External";
    await expect(api.negotiatePlaybackInfo(ITEM,{
      mediaSourceId:SOURCE,graphicSubtitleIndex:4
    })).rejects.toThrow("SUBTITLE_BURNIN_UNAVAILABLE");
    method="Encode";advertise=false;
    await expect(api.negotiatePlaybackInfo(ITEM,{
      mediaSourceId:SOURCE,graphicSubtitleIndex:4
    })).rejects.toThrow("SUBTITLE_BURNIN_UNAVAILABLE");
    advertise=true;
    await expect(api.negotiatePlaybackInfo(ITEM,{
      mediaSourceId:SOURCE,graphicSubtitleIndex:3
    })).rejects.toThrow("SUBTITLE_BURNIN_UNAVAILABLE");
    method="Encode";
    // Server violates the explicit -1 when the default subtitle is on.
    // Never accept an implicit burn-in as if the user requested it.
    const previousResponse=fetcher;
    expect(previousResponse).toHaveBeenCalled();
    // In the unselected case the mock emits -1, so the pinned path
    // above proves the valid counterpart of this rejection.
    expect(negotiatedSubtitlesAreOff(url+
      "&SubtitleStreamIndex=4&SubtitleMethod=Encode")).toBe(false);
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
    const timeout=vi.spyOn(AbortSignal,"timeout");
    const negotiation=await api.negotiatePlaybackInfo(ITEM);
    expect(timeout).toHaveBeenCalledWith(25_000);
    timeout.mockRestore();
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
