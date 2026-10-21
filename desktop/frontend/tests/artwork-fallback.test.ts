import {describe,it,expect,vi,afterEach} from "vitest";
import {ArtworkCache,artworkCandidates,hasArtwork,lazyArtwork} from "../src/artwork";
import {normalizeItem} from "../src/api";
import type {JellyfinApi} from "../src/api";
import type {MediaItem} from "../src/types";

const ID=(n:number)=>n.toString(16).padStart(32,"0");
const media=(n:number,options:Partial<MediaItem>={}):MediaItem=>({
  id:ID(n),title:"Image test "+n,type:"Movie",year:2025,overview:"",
  genres:[],communityRating:null,isFavorite:false,played:false,
  progress:null,premiereDate:"",hasPrimary:true,hasBackdrop:true,
  seriesName:"",...options
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("Jellyfin artwork fallbacks",()=>{
  it("keeps trusted parent and series identifiers from metadata only",()=>{
    const item=normalizeItem({
      Id:ID(10),Type:"Episode",Name:"Episode",SeriesId:ID(22),
      ParentBackdropItemId:ID(20),ParentBackdropImageTags:["p"],
      BackdropImageTags:[],ImageTags:{Thumb:"thumb",Primary:"poster"}
    })!;
    expect(item.seriesId).toBe(ID(22));
    expect(item.parentBackdropItemId).toBe(ID(20));
    expect(item.hasParentBackdrop).toBe(true);
    expect(item.hasThumb).toBe(true);
    expect(hasArtwork(item)).toBe(true);
    expect(artworkCandidates(item,"Backdrop")).toEqual([
      {id:ID(20),kind:"Backdrop"},
      {id:ID(22),kind:"Backdrop"},
      {id:ID(10),kind:"Thumb"},
      {id:ID(10),kind:"Primary"},
      {id:ID(22),kind:"Primary"}
    ]);
    const forged=normalizeItem({
      Id:ID(11),Type:"Episode",Name:"Bad parents",
      SeriesId:"../../unknown",ParentBackdropItemId:"https://evil.example",
      ParentBackdropImageTags:["fake"],ImageTags:{Primary:"poster"}
    })!;
    expect(forged.seriesId).toBeNull();
    expect(forged.parentBackdropItemId).toBeNull();
    expect(artworkCandidates(forged,"Backdrop")).toEqual([
      {id:ID(11),kind:"Primary"}
    ]);
  });
  it("uses shared parent backdrop once for multiple episodes",async()=>{
    const child1=media(31,{hasBackdrop:false,hasPrimary:false,
      hasParentBackdrop:true,parentBackdropItemId:ID(88)});
    const child2=media(32,{hasBackdrop:false,hasPrimary:false,
      hasParentBackdrop:true,parentBackdropItemId:ID(88)});
    const image=vi.fn(async()=>null);
    const imageById=vi.fn(async()=>new Blob(["j"],{type:"image/jpeg"}));
    let counter=0;
    vi.spyOn(URL,"createObjectURL").mockImplementation(()=>"blob:p"+(++counter));
    vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>{});
    const cache=new ArtworkCache({image,imageById} as unknown as JellyfinApi);
    const images=await Promise.all([
      cache.getBest(child1,"Backdrop"),cache.getBest(child2,"Backdrop")
    ]);
    expect(images).toEqual([
      {url:"blob:p1",kind:"Backdrop"},{url:"blob:p1",kind:"Backdrop"}
    ]);
    expect(imageById).toHaveBeenCalledTimes(1);
    expect(imageById).toHaveBeenCalledWith(ID(88),"Backdrop");
    expect(image).not.toHaveBeenCalled();
    cache.clear();
  });
  it("falls back to portrait primary when backdrops and thumbnail fail",async()=>{
    const item=media(40,{hasThumb:true});
    const image=vi.fn(async(_media:MediaItem,kind:string)=>
      kind==="Primary"?new Blob(["poster"],{type:"image/jpeg"}):null);
    let created=0;
    vi.spyOn(URL,"createObjectURL").mockImplementation(()=>"blob:p"+(++created));
    vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>{});
    const cache=new ArtworkCache({image} as unknown as JellyfinApi);
    expect(await cache.getBest(item,"Backdrop")).toEqual({
      url:"blob:p1",kind:"Primary"
    });
    expect(image.mock.calls.map(call=>call[1]))
      .toEqual(["Backdrop","Thumb","Primary"]);
    expect((await cache.getBest(item,"Backdrop"))?.url).toBe("blob:p1");
    expect(image).toHaveBeenCalledTimes(3);
    expect(created).toBe(1);
    cache.clear();
  });
  it("does not create images from an old session after logout",async()=>{
    let complete:((blob:Blob)=>void)|null=null;
    const imageById=vi.fn(()=>new Promise<Blob>(resolve=>{complete=resolve;}));
    const image=vi.fn(async()=>null);
    const mint=vi.spyOn(URL,"createObjectURL").mockReturnValue("blob:old");
    vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>{});
    const cache=new ArtworkCache({image,imageById} as unknown as JellyfinApi);
    const old=cache.getBest(media(40,{hasPrimary:false,hasBackdrop:false,
      hasParentBackdrop:true,parentBackdropItemId:ID(90)}),"Backdrop");
    await vi.waitFor(()=>expect(complete).toBeTypeOf("function"));
    cache.clear();
    complete!(new Blob(["secret"],{type:"image/jpeg"}));
    await expect(old).resolves.toBeNull();
    expect(mint).not.toHaveBeenCalled();
  });
});

describe("shared lazy artwork observer",()=>{
  it("shares one observer and labels poster fallback without extra fetches",async()=>{
    type FakeEntry={isIntersecting:boolean;target:Element};
    const instances:FakeObserver[]=[];
    class FakeObserver{
      targets=new Set<Element>();
      constructor(private callback:(entries:FakeEntry[])=>void){instances.push(this);}
      observe(el:Element){this.targets.add(el);}
      unobserve(el:Element){this.targets.delete(el);}
      disconnect(){this.targets.clear();}
      fire(el:Element){this.callback([{target:el,isIntersecting:true}]);}
    }
    vi.stubGlobal("IntersectionObserver",FakeObserver);
    const cache={getBest:vi.fn(async()=>({
      url:"blob:poster",kind:"Primary" as const
    }))} as unknown as ArtworkCache;
    const node=()=>({
      isConnected:true,dataset:{} as Record<string,string>,
      src:"",naturalWidth:100,naturalHeight:60,complete:true,
      getAttribute(name:string){return name==="src"?this.src:null;},
      addEventListener:vi.fn(),removeEventListener:vi.fn(),
      removeAttribute:vi.fn()
    }) as unknown as HTMLImageElement;
    const first=node(),second=node();
    const a=lazyArtwork(first,{cache,item:media(1),kind:"Backdrop"});
    const b=lazyArtwork(second,{cache,item:media(2),kind:"Backdrop"});
    expect(instances).toHaveLength(1);
    expect(instances[0].targets.size).toBe(2);
    instances[0].fire(first);
    await vi.waitFor(()=>expect(first.src).toBe("blob:poster"));
    expect(first.dataset.vyArtKind).toBe("primary");
    expect(first.dataset.vyArtReady).toBe("true");
    expect(second.src).toBe("");
    instances[0].fire(second);
    await vi.waitFor(()=>expect(second.src).toBe("blob:poster"));
    expect(cache.getBest).toHaveBeenCalledTimes(2);
    a.destroy();b.destroy();
    expect(instances[0].targets.size).toBe(0);
  });
  it("keeps a failed image hidden and resets readiness on content change",async()=>{
    const listeners=new Map<string,()=>void>();
    let src="";
    const el={
      isConnected:true,complete:false,naturalWidth:0,naturalHeight:0,
      dataset:{} as Record<string,string>,
      get src(){return src;},
      set src(value:string){src=value;},
      getAttribute(name:string){return name==="src"?src:null;},
      addEventListener(name:string,fn:()=>void){listeners.set(name,fn);},
      removeEventListener(name:string){listeners.delete(name);},
      removeAttribute(name:string){if(name==="src")src="";}
    } as unknown as HTMLImageElement;
    const cache={getBest:vi.fn(async()=>({
      url:"blob:not-decoded",kind:"Backdrop" as const
    }))} as unknown as ArtworkCache;
    const action=lazyArtwork(el,{cache,item:media(1),kind:"Backdrop"});
    expect(el.dataset.vyArtReady).toBe("false");
    await vi.waitFor(()=>expect(el.src).toBe("blob:not-decoded"));
    listeners.get("error")?.();
    expect(el.dataset.vyArtReady).toBe("false");
    expect(el.getAttribute("src")).toBeNull();
    action.update({cache,item:media(2),kind:"Backdrop"});
    expect(el.dataset.vyArtReady).toBe("false");
    await vi.waitFor(()=>expect(el.src).toBe("blob:not-decoded"));
    (el as unknown as {naturalWidth:number}).naturalWidth=50;
    (el as unknown as {naturalHeight:number}).naturalHeight=30;
    listeners.get("load")?.();
    expect(el.dataset.vyArtReady).toBe("true");
    action.destroy();
    expect(listeners.size).toBe(0);
  });

});

