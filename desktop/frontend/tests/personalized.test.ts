import {describe,it,expect,vi} from "vitest";
import {recommendNative} from "../src/personalized";
import {buildShelves} from "../src/discover";
import {JellyfinApi,SERVER_ORIGIN} from "../src/api";
import type {LibrarySnapshot,MediaItem} from "../src/types";

const ID=(n:number)=>n.toString(16).padStart(32,"0");
const NOW=new Date("2026-10-20T12:00:00Z");
const item=(n:number,genres:string[],opts:Partial<MediaItem>={}):MediaItem=>({
  id:ID(n),title:"Titre "+n,type:"Movie",year:2025,
  premiereDate:"2025-01-01",overview:"",
  genres,communityRating:7,isFavorite:false,played:false,
  progress:null,hasPrimary:true,hasBackdrop:false,seriesName:"",
  ...opts
});
const snapshot=(override:Partial<LibrarySnapshot>={}):LibrarySnapshot=>({
  recent:[],candidates:[],resume:[],nextUp:[],
  favorites:[],watched:[],collections:[],...override
});
describe("Native private, proof-backed discovery",()=>{
  it("uses only genres evidenced in three distinct watches or explicit favorites",()=>{
    const watched=[
      item(1,["Science-fiction"],{played:true}),
      item(2,["Science-fiction"],{played:true}),
      item(3,["Science fiction"],{played:true})
    ];
    const favorites=[item(4,["Comédie"],{isFavorite:true})];
    const input=snapshot({
      watched,favorites,
      candidates:[
        item(11,["Science-fiction"]),
        item(12,["Comedie"],{type:"Series"}),
        item(13,["Documentaire"],{communityRating:10}),
        item(1,["Science-fiction"]),
        item(4,["Comédie"])
      ]
    });
    const outcome=recommendNative(input,NOW);
    expect(outcome.personalized).toBe(true);
    expect(outcome.items.map(x=>x.item.id)).toEqual([ID(11),ID(12)]);
    expect(outcome.items.map(x=>x.reason)).toEqual([
      "Selon vos visionnages : Science-fiction",
      "Genre de vos favoris : Comédie"
    ]);
    const shelves=buildShelves(input,"a".repeat(32),NOW);
    const forYou=shelves.find(row=>row.id==="for-you")!;
    expect(forYou.title).toBe("Pour vous · Selon vos goûts");
    expect(forYou.reasons?.[ID(11)]).toContain("Science-fiction");
    expect(forYou.reasons?.[ID(13)]).toBeUndefined();
  });
  it("does not claim preferences from one watch or global ratings",()=>{
    const input=snapshot({
      watched:[item(1,["Drama"],{played:true})],
      recent:[item(10,["Action"],{communityRating:9.9}),
        item(11,["Drama"],{communityRating:6})]
    });
    const outcome=recommendNative(input,NOW);
    expect(outcome.personalized).toBe(false);
    expect(outcome.items.map(x=>x.item.id)).toEqual([ID(10),ID(11)]);
    expect(outcome.items.every(x=>x.reason===null)).toBe(true);
    expect(buildShelves(input,"a".repeat(32),NOW)
      .find(x=>x.id==="for-you")?.title)
      .toBe("À découvrir dans votre bibliothèque");
  });
  it("excludes already seen, in-progress, next-up, favorited, invalid & future titles",()=>{
    const watched=[
      item(1,["Action"],{played:true}),
      item(2,["Action"],{played:true}),
      item(3,["Action"],{played:true})
    ];
    const input=snapshot({
      watched,favorites:[item(5,["Action"],{isFavorite:true})],
      resume:[item(6,["Action"],{progress:35})],
      nextUp:[item(7,["Action"],{type:"Episode",seriesId:ID(8)})],
      candidates:[
        item(1,["Action"]),item(5,["Action"]),item(6,["Action"]),
        item(7,["Action"]),item(8,["Action"],{type:"Series"}),
        item(9,["Action"],{played:true}),
        item(10,["Action"],{premiereDate:"2026-11-01"}),
        item(11,["Action"],{year:2027}),
        item(12,["Action"],{type:"Episode"}),
        item(13,["Action"],{type:"BoxSet"}),
        item(14,["Action"]),item(14,["Action"])
      ]
    });
    expect(recommendNative(input,NOW).items.map(x=>x.item.id)).toEqual([ID(14)]);
  });
  it("keeps Anime distinct from Animation and normalizes Unicode",()=>{
    const input=snapshot({
      favorites:[item(1,["Anime"],{isFavorite:true})],
      candidates:[
        item(11,["Animation"],{communityRating:10}),
        item(12,["Animé"]),
        item(13,["Anime"])
      ]
    });
    const chosen=recommendNative(input,NOW);
    expect(chosen.personalized).toBe(true);
    expect(chosen.items.map(x=>x.item.id)).toEqual([ID(12),ID(13)]);
    expect(chosen.items.every(x=>x.reason?.includes("Anime"))).toBe(true);
  });
  it("is deterministic and balances title types without inventing model input",()=>{
    const watched=[item(1,["Action"],{played:true}),
      item(2,["Action"],{played:true}),item(3,["Action"],{played:true})];
    const input=snapshot({
      watched,candidates:Array.from({length:22},(_,i)=>
        item(100+i,["Action"],{type:i%3?"Movie":"Series",
          communityRating:i%4+6}))
    });
    const first=recommendNative(input,NOW,12);
    const second=recommendNative(input,NOW,12);
    expect(first).toEqual(second);
    expect(first.items).toHaveLength(12);
    expect(first.items.some(x=>x.item.type==="Series")).toBe(true);
    expect(first.items.every(x=>!x.reason?.includes("IA locale"))).toBe(true);
    expect(new Set(first.items.map(x=>x.item.id)).size).toBe(12);
  });
  it("limits requests and handles an empty library without fake results",()=>{
    expect(recommendNative(snapshot(),NOW)).toEqual({
      items:[],personalized:false
    });
    expect(()=>recommendNative(snapshot(),NOW,25)).toThrow("RECOMMENDER_INVALID");
    expect(()=>recommendNative(snapshot(),new Date(NaN))).toThrow("RECOMMENDER_INVALID");
  });
});

describe("user-scoped recommendation feed",()=>{
  it("requests only bounded Jellyfin metadata and never exposes tokens in URLs",async()=>{
    const USER="a".repeat(32),TOKEN="t".repeat(56);
    const calls:Array<{url:URL,opts:RequestInit}>=[];
    const fetcher=vi.fn(async(input:RequestInfo|URL,opts:RequestInit={})=>{
      const url=new URL(String(input));calls.push({url,opts});
      if(url.pathname==="/Users/AuthenticateByName")
        return new Response(JSON.stringify({User:{Id:USER},AccessToken:TOKEN}),
          {headers:{"Content-Type":"application/json"}});
      if(url.pathname==="/Users/Me")
        return new Response(JSON.stringify({Id:USER,Name:"Alice"}),
          {headers:{"Content-Type":"application/json"}});
      return new Response(JSON.stringify({Items:[{
        Id:ID(42),Name:"À découvrir",Type:"Series",
        Genres:["Action"],UserData:{Played:false}
      }]}),{headers:{"Content-Type":"application/json"}});
    }) as typeof fetch;
    const api=new JellyfinApi({fetcher});
    await api.login("Alice","secret");
    expect((await api.getCandidates()).map(x=>x.id)).toEqual([ID(42)]);
    const itemsCall=calls.find(c=>c.url.pathname==="/Users/"+USER+"/Items")!;
    expect(itemsCall.url.searchParams.get("Filters")).toBe("IsUnplayed");
    expect(itemsCall.url.searchParams.get("Limit")).toBe("128");
    expect(itemsCall.url.searchParams.get("IncludeItemTypes"))
      .toBe("Movie,Series");
    expect(calls.every(c=>c.url.origin===SERVER_ORIGIN)).toBe(true);
    expect(calls.every(c=>!c.url.href.includes(TOKEN))).toBe(true);
    expect(itemsCall.opts.headers).toMatchObject({
      Authorization:expect.stringContaining(TOKEN)
    });
  });
  it("never resolves candidates from an old session",async()=>{
    const USER="a".repeat(32),TOKEN="t".repeat(56);
    let unblock!:(reply:Response)=>void;
    const json=(value:unknown)=>new Response(JSON.stringify(value),
      {headers:{"Content-Type":"application/json"}});
    const fetcher=vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input));
      if(url.pathname==="/Users/AuthenticateByName")
        return json({User:{Id:USER},AccessToken:TOKEN});
      if(url.pathname==="/Users/Me")return json({Id:USER,Name:"Alice"});
      return new Promise<Response>(resolve=>{unblock=resolve;});
    }) as typeof fetch;
    const api=new JellyfinApi({fetcher});
    await api.login("Alice","secret");
    const pending=api.getCandidates();
    await vi.waitFor(()=>expect(unblock).toBeTypeOf("function"));
    api.logout();
    unblock(json({Items:[{Id:ID(42),Type:"Movie",Name:"Private"}]}));
    await expect(pending).rejects.toThrow("SESSION_CHANGED");
    await expect(api.getCandidates()).rejects.toThrow("AUTH_REQUIRED");
  });
});
