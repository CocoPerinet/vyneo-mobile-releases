import type {MediaItem} from "./types";
import type {JellyfinApi} from "./api";

type Kind="Primary"|"Backdrop";
type ImageKind=Kind|"Thumb";
type ImageCandidate={id:string;kind:ImageKind};
export type ResolvedArtwork={url:string;kind:ImageKind};

const VALID_ID=/^[a-f0-9]{32}$/i;
export function hasArtwork(item:MediaItem):boolean {
  return item.hasBackdrop || item.hasPrimary || item.hasThumb===true ||
    Boolean(item.hasParentBackdrop && item.parentBackdropItemId) ||
    Boolean(item.seriesId);
}
export function artworkCandidates(item:MediaItem,kind:Kind):ImageCandidate[]{
  const result:ImageCandidate[]=[],seen=new Set<string>();
  const add=(id:string|null|undefined,type:ImageKind)=>{
    if(!id || !VALID_ID.test(id))return;
    const key=id.toLowerCase()+":"+type;
    if(seen.has(key))return;
    seen.add(key);result.push({id,kind:type});
  };
  if(kind==="Backdrop"){
    if(item.hasBackdrop)add(item.id,"Backdrop");
    if(item.hasParentBackdrop)add(item.parentBackdropItemId,"Backdrop");
    // Episodic items can inherit a series backdrop without carrying its tags.
    if(item.seriesId)add(item.seriesId,"Backdrop");
    if(item.hasThumb)add(item.id,"Thumb");
    if(item.hasPrimary)add(item.id,"Primary");
    if(item.seriesId)add(item.seriesId,"Primary");
  }else{
    if(item.hasPrimary)add(item.id,"Primary");
    if(item.seriesId)add(item.seriesId,"Primary");
    if(item.hasThumb)add(item.id,"Thumb");
    if(item.hasBackdrop)add(item.id,"Backdrop");
  }
  return result;
}
export class ArtworkCache {
  private urls=new Map<string,string>();
  private missing=new Map<string,number>();
  private pending=new Map<string,Promise<string|null>>();
  private active=0;
  private queue:Array<()=>void>=[];
  private generation=0;
  constructor(private api:JellyfinApi,private cap=76){}
  private async acquire():Promise<void>{
    if(this.active<3){this.active++;return;}
    await new Promise<void>(resolve=>this.queue.push(resolve));
    this.active++;
  }
  private release(){
    this.active--;
    this.queue.shift()?.();
  }
  private async loadCandidate(item:MediaItem,candidate:ImageCandidate):
    Promise<string|null>{
    const key=candidate.id.toLowerCase()+":"+candidate.kind;
    const old=this.urls.get(key);
    if(old){
      // LRU: moving the hit to the end keeps recently visible art warm.
      this.urls.delete(key);this.urls.set(key,old);
      return old;
    }
    const expires=this.missing.get(key);
    if(expires && expires>Date.now())return null;
    if(expires)this.missing.delete(key);
    const existing=this.pending.get(key);
    if(existing)return existing;
    const epoch=this.generation;
    const job=(async()=>{
      await this.acquire();
      try{
        if(epoch!==this.generation)return null;
        const blob=candidate.id===item.id
          ?await this.api.image(item,candidate.kind)
          :await this.api.imageById(candidate.id,candidate.kind);
        if(epoch!==this.generation)return null;
        if(!blob){
          // Jellyfin often has no thumbnail for old library entries:
          // avoid refetching the same missing asset on each navigation.
          this.missing.set(key,Date.now()+30000);
          while(this.missing.size>this.cap){
            const first=this.missing.keys().next().value;
            if(!first)break;
            this.missing.delete(first);
          }
          return null;
        }
        const url=URL.createObjectURL(blob);
        this.urls.set(key,url);
        while(this.urls.size>this.cap){
          const first=this.urls.keys().next().value;
          if(!first)break;
          URL.revokeObjectURL(this.urls.get(first)!);
          this.urls.delete(first);
        }
        return url;
      }catch{return null;}
      finally{this.release();}
    })();
    this.pending.set(key,job);
    try{return await job;}
    finally{if(this.pending.get(key)===job)this.pending.delete(key);}
  }
  async getBest(item:MediaItem,kind:Kind):Promise<ResolvedArtwork|null>{
    const epoch=this.generation;
    for(const candidate of artworkCandidates(item,kind)){
      if(epoch!==this.generation)return null;
      const url=await this.loadCandidate(item,candidate);
      if(epoch!==this.generation)return null;
      if(url)return {url,kind:candidate.kind};
    }
    return null;
  }
  async get(item:MediaItem,kind:Kind):Promise<string|null>{
    return (await this.getBest(item,kind))?.url??null;
  }
  clear(){
    this.generation++;
    for(const url of this.urls.values())URL.revokeObjectURL(url);
    this.urls.clear();
    this.missing.clear();
    this.pending.clear();
    // In-flight API responses from the previous session are rejected above.
  }
}
export interface LazyArt{
  cache:ArtworkCache;
  item:MediaItem;
  kind:Kind;
}
// One observer for all native cards instead of hundreds of separate
// IntersectionObserver instances on a large paginated library.
const waiting=new Map<HTMLImageElement,()=>void>();
let sharedObserver:IntersectionObserver|null=null;
function stopWatching(node:HTMLImageElement){
  if(!waiting.delete(node))return;
  sharedObserver?.unobserve(node);
  if(waiting.size===0){sharedObserver?.disconnect();sharedObserver=null;}
}
function watch(node:HTMLImageElement,load:()=>void){
  if(typeof IntersectionObserver==="undefined"){load();return;}
  if(!sharedObserver){
    sharedObserver=new IntersectionObserver(entries=>{
      for(const entry of entries){
        if(!entry.isIntersecting)continue;
        const el=entry.target as HTMLImageElement;
        const callback=waiting.get(el);
        if(callback){stopWatching(el);callback();}
      }
    },{rootMargin:"220px 300px"});
  }
  waiting.set(node,load);
  sharedObserver.observe(node);
}
export function lazyArtwork(node:HTMLImageElement,initial:LazyArt){
  let options=initial,generation=0,loaded=false;
  let assignedUrl:string|null=null;
  // A Blob URL can exist before the browser has decoded it. An <img>
  // without src (or with a failed src) otherwise exposes its broken-image
  // icon in the middle of an otherwise valid Jellyfin card.
  node.dataset.vyArtReady="false";
  function onLoad(){
    if(assignedUrl && node.getAttribute("src")===assignedUrl &&
      node.naturalWidth>0 && node.naturalHeight>0)
      node.dataset.vyArtReady="true";
  }
  function onError(){
    if(assignedUrl && node.getAttribute("src")===assignedUrl){
      node.dataset.vyArtReady="false";
      node.removeAttribute("src");
      assignedUrl=null;
    }
  }
  node.addEventListener("load",onLoad);
  node.addEventListener("error",onError);
  async function load(){
    if(loaded)return;
    loaded=true;
    const run=generation;
    const resolved=await options.cache.getBest(options.item,options.kind);
    if(resolved && run===generation && node.isConnected){
      node.dataset.vyArtReady="false";
      node.dataset.vyArtKind=resolved.kind.toLowerCase();
      assignedUrl=resolved.url;
      node.src=resolved.url;
      // Cached and decoded images can already be ready synchronously.
      if(node.complete)onLoad();
    }
  }
  function observe(){
    loaded=false;
    watch(node,()=>{void load();});
  }
  observe();
  return {
    update(next:LazyArt){
      if(options.item.id===next.item.id && options.kind===next.kind &&
         options.cache===next.cache)return;
      generation++;options=next;
      stopWatching(node);assignedUrl=null;
      node.dataset.vyArtReady="false";
      node.removeAttribute("src");
      delete node.dataset.vyArtKind;
      observe();
    },
    destroy(){
      generation++;assignedUrl=null;stopWatching(node);
      node.removeEventListener("load",onLoad);
      node.removeEventListener("error",onError);
    }
  };
}
