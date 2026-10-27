import {describe,it,expect,vi} from "vitest";
import {JellyfinApi,normalizeItem,SERVER_ORIGIN,
  PLAYBACK_INSPECTION_TIMEOUT_MS} from "../src/api";
import {parsePlaybackInfo,parseSeasons,preferredSeasonFromShelves,
  selectInitialSeason} from "../src/media-details";

const USER="a".repeat(32),SHOW="b".repeat(32),SEASON="c".repeat(32);
const FILM="d".repeat(32),TOKEN="x".repeat(64);
const id=(n:number)=>n.toString(16).padStart(32,"0");
const response=(body:unknown)=>new Response(JSON.stringify(body),{
  headers:{"Content-Type":"application/json"}
});
const episode=(n:number)=>({
  Id:id(n),Name:"Episode "+n,Type:"Episode",IndexNumber:n,
  ParentIndexNumber:1,SeriesId:SHOW,RunTimeTicks:1_200_000_000,
  UserData:{IsFavorite:false,Played:false},ImageTags:{Thumb:"a"}
});
const mediaSources=()=>({
  PlaySessionId:"sensitive-session-id",
  MediaSources:[{
    Id:"some-id",Name:"Original",Container:"mkv",Bitrate:8_000_000,
    Path:"/mnt/secret/movies/film.mkv",
    TranscodingUrl:"https://example.invalid/?api_key=SECRET",
    SupportsDirectPlay:true,SupportsDirectStream:true,
    SupportsTranscoding:true,IsRemote:true,
    RunTimeTicks:13741910000,MediaStreams:[
      {Type:"Video",Index:0,Codec:"hevc",Width:3840,Height:2160,
        DisplayTitle:"4K HEVC"},
      {Type:"Audio",Index:1,Codec:"aac",Channels:6,
        Language:"fra",IsDefault:true},
      {Type:"Subtitle",Index:2,Codec:"srt",Language:"eng",
        IsExternal:true},
      {Type:"Secret",Index:9,Codec:"private"}
    ]
  }]
});
function fixture(){
  const calls:Array<{url:URL;opts:RequestInit}>=[];
  let hold:(response:Response)=>void=()=>{};
  let delayed=false;
  const fetcher=vi.fn(async (input:RequestInfo|URL,opts:RequestInit={})=>{
    const url=new URL(String(input));calls.push({url,opts});
    if(url.pathname==="/Users/AuthenticateByName")
      return response({User:{Id:USER},AccessToken:TOKEN});
    if(url.pathname==="/Users/Me")
      return response({Id:USER,Name:"Alice"});
    if(url.pathname==="/Users/"+USER+"/Items/"+FILM)
      return response({Id:FILM,Name:"Test",Type:"Movie",
        Overview:"Détails complets",RunTimeTicks:9_600_000_000});
    if(url.pathname==="/Shows/"+SHOW+"/Seasons")
      return response({Items:[{
        Id:SEASON,Name:"Saison 1",IndexNumber:1,ChildCount:27
      }]});
    if(url.pathname==="/Shows/"+SHOW+"/Episodes"){
      const offset=Number(url.searchParams.get("StartIndex"));
      return response({Items:Array.from({length:27},(_,i)=>episode(i+1))
        .slice(offset,offset+Number(url.searchParams.get("Limit"))),
        TotalRecordCount:27});
    }
    if(url.pathname==="/Items/"+FILM+"/PlaybackInfo"){
      if(delayed)return new Promise<Response>(resolve=>{hold=resolve;});
      return response(mediaSources());
    }
    throw new Error("unexpected test path "+url.pathname);
  }) as typeof fetch;
  return {api:new JellyfinApi({fetcher}),calls,
    delay:()=>{delayed=true;},release:()=>hold(response(mediaSources()))};
}
describe("default user season, read-only evidence",()=>{
  const season=(value:number,unplayed:number|null,
    count:number|null=12)=>({
    id:id(value),title:value===0?"Spéciaux":"Saison "+value,
    number:value,episodeCount:count,unplayedCount:unplayed
  });
  const shelvesEpisode=(value:number,seriesId:string,seasonId:string)=>
    normalizeItem({
      Id:id(value),Name:"Épisode",Type:"Episode",
      SeriesId:seriesId,SeasonId:seasonId,IndexNumber:1,
      ParentIndexNumber:2,UserData:{Played:false,IsFavorite:false}
    })!;
  it("prefers an in-progress resume over NextUp of the same series",()=>{
    const resume=[
      shelvesEpisode(101,SHOW,id(2)),
      shelvesEpisode(102,id(77),id(9))
    ];
    const next=[shelvesEpisode(103,SHOW,id(3))];
    expect(preferredSeasonFromShelves(SHOW,resume,next)).toBe(id(2));
    expect(preferredSeasonFromShelves(SHOW,[],next)).toBe(id(3));
    expect(preferredSeasonFromShelves(id(44),resume,next)).toBeNull();
  });
  it("matches auth-scoped episode metadata without leaking foreign series",()=>{
    const valid=shelvesEpisode(105,SHOW,id(0xabcd));
    expect(preferredSeasonFromShelves(SHOW.toUpperCase(),[valid],[]))
      .toBe(id(0xabcd));
    expect(preferredSeasonFromShelves("invalid",[valid],[])).toBeNull();
    expect(preferredSeasonFromShelves(SHOW,
      [{...valid,seasonId:"bad-id"}],[])).toBeNull();
  });
  it("opens actual next or resumed season, including explicit specials",()=>{
    const all=[season(0,3,5),season(1,0),season(2,6),season(3,12)];
    expect(selectInitialSeason(all,id(3))?.number).toBe(3);
    expect(selectInitialSeason(all,id(0))?.number).toBe(0);
    // A stale missing season gracefully falls back to watched counts.
    expect(selectInitialSeason(all,id(999))?.number).toBe(2);
  });
  it("skips specials and completed seasons when first opening a series",()=>{
    const all=[season(0,4),season(1,0),season(2,6),season(3,12)];
    expect(selectInitialSeason(all)?.number).toBe(2);
    expect(selectInitialSeason([season(0,2),season(1,12),
      season(2,12)])?.number).toBe(1);
    expect(selectInitialSeason([season(0,2)])?.number).toBe(0);
  });
  it("does not mistake missing Jellyfin UserData for a completed season",()=>{
    expect(selectInitialSeason([season(1,0),season(2,null),
      season(3,0)])?.number).toBe(2);
    expect(selectInitialSeason([season(1,null),season(2,0)])?.number).toBe(1);
    expect(selectInitialSeason([season(1,0),season(2,0),
      season(3,0)])?.number).toBe(3);
  });
  it("ignores empty seasons, handles unordered input and no seasons",()=>{
    expect(selectInitialSeason([season(3,4),season(0,2,5),
      season(1,0),season(2,1,0)])?.number).toBe(3);
    expect(selectInitialSeason([])).toBeNull();
    expect(selectInitialSeason([season(0,0,0),season(1,0,0)])
      ?.number).toBe(1);
  });
});

describe("read-only native media details",()=>{
  it("normalizes series and episode numbers without leaking file paths",()=>{
    const ep=normalizeItem(episode(3))!;
    expect(ep.type).toBe("Episode");
    expect([ep.seasonNumber,ep.episodeNumber,ep.runtimeTicks])
      .toEqual([1,3,1_200_000_000]);
    expect(ep.seriesId).toBe(SHOW);
    expect(normalizeItem({Id:FILM,Name:"Film",Type:"Movie",
      RunTimeTicks:1800*10_000_000,
      UserData:{PlaybackPositionTicks:650_000_000}})?.resumeTicks)
      .toBe(650_000_000);
  });
  it("parses bounded season lists without duplicate ids",()=>{
    expect(parseSeasons({Items:[
      {Id:SEASON,Name:"Saison 1",IndexNumber:1,ChildCount:27,
        UserData:{UnplayedItemCount:5}},
      {Id:SEASON,Name:"Duplicate",IndexNumber:2},
      {Id:"invalid",Name:"Spoof"},
      {Id:id(4),Name:"Épisodes spéciaux",IndexNumber:0}
    ]})).toEqual([
      {id:id(4),title:"Épisodes spéciaux",number:0,
        episodeCount:null,unplayedCount:null},
      {id:SEASON,title:"Saison 1",number:1,
        episodeCount:27,unplayedCount:5}
    ]);
    expect(()=>parseSeasons({Items:"bad"})).toThrow("SEASONS_INVALID");
  });
  it("returns only safe technical fields, never paths or sessions",()=>{
    const parsed=parsePlaybackInfo(mediaSources());
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.sources[0].id).toBeNull();
    expect(parsed.playSessionId).toBeNull();
    expect(parsePlaybackInfo({
      PlaySessionId:"e".repeat(32),MediaSources:[]
    }).playSessionId).toBe("e".repeat(32));
    expect(parsed.sources[0].container).toBe("MKV");
    expect(parsed.sources[0].isRemote).toBe(true);
    expect(parsed.sources[0].runtimeTicks).toBe(13741910000);
    expect(parsed.sources[0].tracks.map(t=>t.kind))
      .toEqual(["Video","Audio","Subtitle"]);
    expect(parsed.sources[0].tracks[0].height).toBe(2160);
    expect(JSON.stringify(parsed)).not.toMatch(/SECRET|Path|transcodingUrl|api_key|sensitive-session-id/i);
    expect(()=>parsePlaybackInfo({MediaSources:{}}))
      .toThrow("PLAYBACK_INFO_INVALID");
  });
  it("lists a real series scope, paginates episodes, and probes only on demand",async()=>{
    const {api,calls}=fixture();
    await api.login("Alice","secret");
    expect((await api.getItemDetails(FILM)).overview).toBe("Détails complets");
    const seasons=await api.getSeriesSeasons(SHOW);
    expect(seasons[0].episodeCount).toBe(27);
    const first=await api.getSeasonEpisodes(SHOW,SEASON);
    const last=await api.getSeasonEpisodes(SHOW,SEASON,first.nextOffset!);
    expect([first.items.length,last.items.length]).toEqual([24,3]);
    expect([first.nextOffset,last.nextOffset]).toEqual([24,null]);
    expect(calls.every(x=>x.url.origin===SERVER_ORIGIN)).toBe(true);
    expect(calls.every(x=>!x.url.href.includes(TOKEN))).toBe(true);
    expect(calls.every(x=>x.opts.credentials==="omit")).toBe(true);
    expect(calls.some(x=>x.url.pathname.endsWith("/PlaybackInfo"))).toBe(false);
    const timeout=vi.spyOn(AbortSignal,"timeout");
    let probe;
    try{
      probe=await api.getPlaybackInfo(FILM);
      expect(timeout).toHaveBeenCalledWith(PLAYBACK_INSPECTION_TIMEOUT_MS);
      expect(PLAYBACK_INSPECTION_TIMEOUT_MS).toBe(25_000);
    }finally{timeout.mockRestore();}
    expect(probe.sources[0].tracks).toHaveLength(3);
    expect(calls.at(-1)?.url.searchParams.get("userId")).toBe(USER);
    expect(calls.at(-1)?.opts.headers).toMatchObject({
      Authorization:expect.stringContaining(TOKEN)
    });
  });
  it("rejects stale playback probes after logout",async()=>{
    const {api,delay,release,calls}=fixture();
    await api.login("Alice","secret");
    delay();
    const pending=api.getPlaybackInfo(FILM);
    await vi.waitFor(()=>expect(calls.some(c=>
      c.url.pathname.endsWith("/PlaybackInfo"))).toBe(true));
    api.logout();
    release();
    await expect(pending).rejects.toThrow("SESSION_CHANGED");
    await expect(api.getSeriesSeasons(SHOW)).rejects.toThrow("AUTH_REQUIRED");
  });
  it("classifies a fetch timeout without forwarding a sensitive error",async()=>{
    const fetcher=vi.fn(async()=>{
      throw new DOMException(
        "Sensitive upstream URL: https://private.invalid/?api_key=SECRET",
        "TimeoutError");
    }) as typeof fetch;
    const api=new JellyfinApi({fetcher});
    await expect(api.login("Alice","password"))
      .rejects.toThrow("REQUEST_TIMEOUT");
    const failingNetwork=vi.fn(async()=>{
      throw new TypeError("Sensitive path https://private.invalid/");
    }) as typeof fetch;
    await expect(new JellyfinApi({fetcher:failingNetwork})
      .login("Alice","password")).rejects.toThrow("NETWORK_UNAVAILABLE");
  });
  it("rejects invalid ids and episodes parameters before sending requests",async()=>{
    const {api,calls}=fixture();
    await api.login("Alice","secret");
    const count=calls.length;
    await expect(api.getItemDetails("../../bad")).rejects.toThrow("ITEM_INVALID");
    await expect(api.getSeriesSeasons("invalid")).rejects.toThrow("SERIES_INVALID");
    await expect(api.getSeasonEpisodes(SHOW,SEASON,-1)).rejects.toThrow("EPISODES_INVALID");
    await expect(api.getSeasonEpisodes(SHOW,SEASON,100001)).rejects.toThrow("EPISODES_INVALID");
    await expect(api.getPlaybackInfo("not-id")).rejects.toThrow("PLAYBACK_ITEM_INVALID");
    expect(calls).toHaveLength(count);
  });
});
