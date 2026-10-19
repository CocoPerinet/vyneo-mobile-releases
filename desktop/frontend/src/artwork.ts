import type {MediaItem} from "./types";
import type {JellyfinApi} from "./api";

type Kind="Primary"|"Backdrop";
export class ArtworkCache {
  private urls=new Map<string,string>();
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
  async get(item:MediaItem,kind:Kind):Promise<string|null>{
    const key=item.id+":"+kind,old=this.urls.get(key);
    if(old){
      // Maintain bounded, recent-first cache without copying personal data.
      this.urls.delete(key);this.urls.set(key,old);
      return old;
    }
    const existing=this.pending.get(key);
    if(existing)return existing;
    const epoch=this.generation;
    const job=(async()=>{
      await this.acquire();
      try{
        if(epoch!==this.generation)return null;
        const blob=await this.api.image(item,kind);
        if(!blob || epoch!==this.generation)return null;
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
  clear(){
    this.generation++;
    for(const url of this.urls.values())URL.revokeObjectURL(url);
    this.urls.clear();
    this.pending.clear();
    // In-flight API responses from the previous session are rejected above.
  }
}
export interface LazyArt{
  cache:ArtworkCache;
  item:MediaItem;
  kind:Kind;
}
export function lazyArtwork(node:HTMLImageElement,initial:LazyArt){
  let options=initial,generation=0;
  let observer:IntersectionObserver|null=null;
  let loaded=false;
  async function load(){
    if(loaded)return;
    loaded=true;const run=generation;
    const src=await options.cache.get(options.item,options.kind);
    if(src && run===generation && node.isConnected)node.src=src;
  }
  function observe(){
    loaded=false;
    if(typeof IntersectionObserver==="undefined"){void load();return;}
    if(!observer)observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){
        observer?.unobserve(node);void load();
      }
    },{rootMargin:"220px 300px"});
    observer.observe(node);
  }
  observe();
  return {
    update(next:LazyArt){
      if(options.item.id===next.item.id && options.kind===next.kind &&
         options.cache===next.cache)return;
      generation++;options=next;
      observer?.unobserve(node);node.removeAttribute("src");
      observe();
    },
    destroy(){generation++;observer?.disconnect();}
  };
}
