import {describe,it,expect,vi} from "vitest";
import {requestNativeG7y,mergeNativeG7y} from "../src/g7z-secure-shelves";
import type {MediaItem,Shelf} from "../src/types";

const id=(n:number)=>n.toString(16).padStart(32,"0");
const now=new Date("2026-10-20T12:00:00.000Z");
const uid=id(900);
const item=(n:number):MediaItem=>({
  id:id(n),title:"Own Jellyfin "+n,type:"Movie",year:2025,
  overview:"Private metadata",genres:["Adventure"],
  communityRating:7,played:false,isFavorite:false,progress:null,
  premiereDate:"2025-09-05",hasBackdrop:true,hasPrimary:true,
  seriesName:""
});
const card=(n:number,rank?:number)=>({
  id:id(n),type:"Movie",title:"Remote title "+n,
  year:2025,caption:rank===undefined?
    "À découvrir dans votre bibliothèque":"Sélection de votre catalogue",
  progressPercent:null,...(rank===undefined?{}:{rank})
});
const payload=()=>({
  schema:"vyneo.g7x.private_rotating_shelves.v1",
  top:[card(1,1),card(2,2),card(3,3)],
  topTitle:"Top 3 à découvrir",topCount:3,
  sections:[{key:"rotation-adventure",title:"À explorer · Aventures",
    items:[card(4),card(5)]}],
  count:1,rotationDate:"2026-10-20",
  nextRotationDate:"2026-10-21",availableRecipes:46,
  rankingBasis:"catalogue_and_personal_affinity_not_views",
  userEntitlementVerified:false,realPlaybackAuthorized:false,
  playableUrls:0,mediaBytesRead:0
});
const allowed=()=>[1,2,3,4,5].map(item);
const stamp=()=>({userId:uid,epoch:3});
describe("G7z native-to-desktop shelf boundary",()=>{
  it("shows only previously authorized local Jellyfin metadata",async()=>{
    const read=vi.fn(async()=>payload());
    const rows=await requestNativeG7y({
      current:stamp,allowed,nativeTransport:read,now:()=>now
    });
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(uid);
    expect(rows?.map(row=>row.items.length)).toEqual([3,2]);
    expect(rows?.[0]?.items[0].title).toBe("Own Jellyfin 1");
    expect(JSON.stringify(rows)).not.toContain("Remote title");
  });
  it("silently keeps local fallback when native bridge is unavailable",async()=>{
    const rows=await requestNativeG7y({
      current:stamp,allowed,
      nativeTransport:async()=>{throw Error("Access is offline");}
    });
    expect(rows).toBeNull();
    const local:[Shelf]=[{id:"for-you",title:"Pour vous",
      items:[item(1)]}];
    expect(mergeNativeG7y(local,rows)).toEqual(local);
  });
  it("never contacts native transport before a valid identity is present",async()=>{
    const read=vi.fn(async()=>payload());
    for(const bad of [null,{userId:"../user",epoch:2},
                      {userId:uid,epoch:-1}]){
      const rows=await requestNativeG7y({
        current:()=>bad,allowed,nativeTransport:read
      });
      expect(rows).toBeNull();
    }
    expect(read).not.toHaveBeenCalled();
  });
  it("drops in-flight G7y response after logout",async()=>{
    let resolve!:(x:unknown)=>void;
    let current:{userId:string;epoch:number}|null=stamp();
    const pending=requestNativeG7y({
      current:()=>current,allowed,
      nativeTransport:()=>new Promise(x=>{resolve=x;}),
      now:()=>now
    });
    await vi.waitFor(()=>expect(resolve).toBeTypeOf("function"));
    current=null;resolve(payload());
    expect(await pending).toBeNull();
  });
  it("drops result after same-account epoch rotation",async()=>{
    let resolve!:(x:unknown)=>void;
    let current=stamp();
    const pending=requestNativeG7y({
      current:()=>current,allowed,
      nativeTransport:()=>new Promise(x=>{resolve=x;}),
      now:()=>now
    });
    await vi.waitFor(()=>expect(resolve).toBeTypeOf("function"));
    current={...current,epoch:4};resolve(payload());
    expect(await pending).toBeNull();
  });
  it("refuses unknown title, playback data or false access claims",async()=>{
    for(const mutate of [
      (x:ReturnType<typeof payload>)=>{
        x.top[0]={...x.top[0],id:id(999)};
      },
      (x:ReturnType<typeof payload>)=>{
        x.top[0]={...x.top[0],playbackUrl:"/secret"} as typeof x.top[0];
      },
      (x:ReturnType<typeof payload>)=>{
        x.userEntitlementVerified=true;
      },
      (x:ReturnType<typeof payload>)=>{
        x.mediaBytesRead=1;
      }
    ]){
      const raw=payload();mutate(raw);
      const rows=await requestNativeG7y({
        current:stamp,allowed,nativeTransport:async()=>raw,now:()=>now
      });
      expect(rows).toBeNull();
    }
  });
  it("cannot insert duplicates into existing Resume/For You shelves",async()=>{
    const local:Shelf[]=[
      {id:"resume",title:"Reprendre",items:[item(1)]},
      {id:"for-you",title:"Pour vous",items:[item(2)]}
    ];
    const remote=await requestNativeG7y({
      current:stamp,allowed,nativeTransport:async()=>payload(),
      now:()=>now
    });
    const rows=mergeNativeG7y(local,remote);
    expect(rows.slice(0,2)).toEqual(local);
    const ids=rows.flatMap(row=>row.items.map(x=>x.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(rows.map(row=>row.title)).toContain("À explorer · Aventures");
    expect(rows.find(x=>x.id==="g7y-top")?.title)
      .toBeUndefined(); // Less than two original Top cards remain.
  });
});

