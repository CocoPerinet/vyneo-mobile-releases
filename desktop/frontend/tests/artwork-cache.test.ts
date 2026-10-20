import {describe,it,expect,vi,afterEach} from "vitest";
import {ArtworkCache} from "../src/artwork";
import type {JellyfinApi} from "../src/api";
import type {MediaItem} from "../src/types";

const item=(index:number):MediaItem=>({
  id:index.toString(16).padStart(32,"0"),title:"Titre fictif "+index,
  type:"Movie",year:2026,overview:"",genres:[],
  communityRating:null,isFavorite:false,played:false,progress:null,
  premiereDate:"2026-01-01",hasPrimary:true,hasBackdrop:true,seriesName:""
});
afterEach(()=>vi.restoreAllMocks());
describe("private artwork cache lifetime and contention",()=>{
  it("reuses existing Blob URL without a new network fetch",async()=>{
    const fetch=vi.fn(async()=>new Blob(["image"],{type:"image/jpeg"}));
    const api={image:fetch} as unknown as JellyfinApi;
    const create=vi.spyOn(URL,"createObjectURL").mockReturnValue("blob:first");
    const revoke=vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>{});
    const cache=new ArtworkCache(api,3);
    expect(await cache.get(item(1),"Primary")).toBe("blob:first");
    expect(await cache.get(item(1),"Primary")).toBe("blob:first");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    cache.clear();
    expect(revoke).toHaveBeenCalledWith("blob:first");
  });
  it("evicts old account media when capacity is exceeded",async()=>{
    const api={image:vi.fn(async()=>new Blob(["pic"]))} as unknown as JellyfinApi;
    let next=0;
    vi.spyOn(URL,"createObjectURL").mockImplementation(()=>"blob:"+ ++next);
    const revoke=vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>{});
    const cache=new ArtworkCache(api,2);
    await cache.get(item(1),"Primary");
    await cache.get(item(2),"Primary");
    await cache.get(item(3),"Primary");
    expect(revoke).toHaveBeenCalledWith("blob:1");
    cache.clear();
    expect(revoke).toHaveBeenCalledWith("blob:2");
    expect(revoke).toHaveBeenCalledWith("blob:3");
  });
  it("never imports the old account's pending image after logout",async()=>{
    let complete:(value:Blob)=>void=()=>{};
    const api={image:vi.fn(()=>new Promise<Blob>(resolve=>{
      complete=resolve;
    }))} as unknown as JellyfinApi;
    const mint=vi.spyOn(URL,"createObjectURL").mockReturnValue("blob:private");
    const cache=new ArtworkCache(api,3);
    const promise=cache.get(item(88),"Primary");
    await Promise.resolve();
    cache.clear();
    complete(new Blob(["secret"],{type:"image/jpeg"}));
    expect(await promise).toBeNull();
    expect(mint).not.toHaveBeenCalled();
  });
  it("never exceeds three simultaneous network image requests",async()=>{
    let active=0,maximum=0;
    const api={
      image:vi.fn(async()=>{
        active++;maximum=Math.max(maximum,active);
        await new Promise(resolve=>setTimeout(resolve,3));
        active--;return new Blob(["pic"]);
      })
    } as unknown as JellyfinApi;
    let next=0;
    vi.spyOn(URL,"createObjectURL").mockImplementation(()=>"blob:"+ ++next);
    vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>{});
    const cache=new ArtworkCache(api,12);
    await Promise.all(Array.from({length:10},(_,i)=>
      cache.get(item(i+1),"Backdrop")));
    expect(maximum).toBeLessThanOrEqual(3);
    cache.clear();
  });
});
