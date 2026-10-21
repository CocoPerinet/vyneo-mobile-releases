import type {LibrarySnapshot,MediaItem,Shelf} from "./types";
import {rotatingEditorial} from "./editorial-recipes";
import {hasArtwork} from "./artwork";
import {recommendNative} from "./personalized";

const unique=(items:MediaItem[],limit=30):MediaItem[]=>{
  const used=new Set<string>();
  return items.filter(item=>{
    if(used.has(item.id))return false;
    used.add(item.id);return true;
  }).slice(0,limit);
};
export function buildShelves(data:LibrarySnapshot,uid:string,now=new Date()):Shelf[]{
  const recent=unique(data.recent,96);
  // Match the Jellyfin skin: playback state can be stale for .strm files.
  // A title at >=95% is finished even if Jellyfin did not mark Played yet.
  const resume=unique(data.resume.filter(item=>
    !item.played && (item.progress===null || item.progress<95)),16);
  // Do not arbitrarily discard NextUp after 22 titles. The rail can
  // scroll through every authorized continuation returned by Jellyfin.
  const nextUp=unique(data.nextUp,600);
  const favorites=unique(data.favorites,30);
  const collections=unique(data.collections,36);
  const recommendations=recommendNative(data,now,18);
  const reasons=Object.fromEntries(recommendations.items
    .filter(r=>r.reason!==null).map(r=>[r.item.id,r.reason!]));
  // A recent release means its actual production/premiere year, not
  // the date somebody added a 1999 film to their Jellyfin server.
  const currentYear=now.getUTCFullYear();
  const rated=unique([...(data.candidates??[]),...recent],640)
    .filter(item=>(item.type==="Movie" || item.type==="Series") &&
      item.year!==null && item.year>=currentYear-2 &&
      item.year<=currentYear &&
      item.communityRating!==null && item.communityRating>=6.5 &&
      !item.played && !item.isFavorite)
    .sort((a,b)=>(b.communityRating??0)-(a.communityRating??0) ||
      (b.year??0)-(a.year??0) || a.title.localeCompare(b.title))
    .slice(0,10);
  // The publicly documented G7x recipe taxonomy can run locally on
  // per-user metadata. Model-assisted G7y classification is NOT claimed.
  // These recipes rotate daily; each row needs >=3 evidence-backed titles.
  const editorial=rotatingEditorial(recent,uid,now,10,5);
  const rows:Shelf[]=[];
  const put=(id:string,title:string,items:MediaItem[],
    kind:Shelf["kind"]="standard")=>{
    // Preserve the full, already bounded NextUp shelf instead of applying
    // the default 30-item limit a second time.
    if(items.length)rows.push({id,title,items:unique(items,
      id==="next-up"?600:30),kind});
  };
  put("resume","Reprendre la lecture",resume);
  put("next-up","À suivre",nextUp);
  // The active Jellyfin skin titles its recommendation rail exactly
  // "Pour vous". Keep the non-personalized fallback honest and explicit.
  put("for-you",recommendations.personalized?"Pour vous":
    "À explorer dans votre bibliothèque",
    recommendations.items.map(r=>r.item));
  const forYou=rows.find(row=>row.id==="for-you");
  if(forYou && recommendations.personalized)forYou.reasons=reasons;
  put("top-ten",rated.length===10?"Top 10 · Sorties récentes":
    "Les mieux notés · Sorties récentes",rated,
    rated.length===10?"top10":"standard");
  put("favorites","Dans votre liste",favorites);
  rows.push(...editorial);
  put("universes","Sagas et collections",collections,"universe");
  return rows;
}
/** Stable order from the authenticated Jellyfin custom Home (2026-10-21):
 * Reprendre -> À suivre -> Nouvelles saisons -> Univers (separate logo rail)
 * -> Tendances -> Pour vous. Optional editorial shelves follow afterward.
 *
 * This keeps fallback shelves rather than hiding them and is insensitive to
 * the order in which asynchronous recommendations or popularity arrive.
 */
export function orderHomeShelves(rows:readonly Shelf[]):Shelf[]{
  const first=new Map([
    ["resume",0],["next-up",1],["new-seasons",2],
    ["trending",3],["for-you",4],["top-ten",5],["favorites",6]
  ]);
  return rows.map((shelf,index)=>({shelf,index})).sort((a,b)=>
    (first.get(a.shelf.id)??100)-(first.get(b.shelf.id)??100) ||
    a.index-b.index
  ).map(({shelf})=>shelf);
}
// The Jellyfin skin's curated hero targets sixteen titles and preserves
// *all* confirmed new seasons/suite releases (inject.js:15240-15320).
// The prior five-slide Desktop shortcut hid most of the real banner pool.
export function featuredSlides(rows:Shelf[],limit=16):MediaItem[]{
  const target=Math.max(1,Math.min(32,Math.floor(limit)));
  const selected:MediaItem[]=[],used=new Set<string>();
  const candidate=(item:MediaItem)=>
    !item.played && hasArtwork(item) && (
      item.type==="Movie" || item.type==="Series" || item.type==="Episode");
  const add=(item:MediaItem|undefined)=>{
    if(!item || !candidate(item))return;
    // A show represented by several episodes must never occupy multiple
    // hero slides. Series/episode artworks are frequently identical.
    const key=(item.seriesId??item.id).toLowerCase();
    if(used.has(key))return;
    used.add(key);selected.push(item);
  };
  const news=rows.find(row=>row.id==="new-seasons")?.items??[];
  const trend=rows.find(row=>row.id==="trending")?.items??
    rows.find(row=>row.id==="top-ten")?.items??[];
  const personal=rows.find(row=>row.id==="for-you")?.items??[];
  const editorial=rows.filter(row=>row.id.startsWith("editorial-"))
    .flatMap(row=>row.items);
  const groups=[news,trend,personal,editorial];
  // Reserve room for all unseen confirmed new releases before balancing
  // editorial sources. Otherwise 16 ordinary recommendations could evict
  // a later S2E1 despite the real Jellyfin policy forbidding that.
  const guaranteed=new Set(news.filter(candidate)
    .map(item=>(item.seriesId??item.id).toLowerCase()));
  let pendingNews=guaranteed.size;
  const maxLen=Math.max(0,...groups.map(group=>group.length));
  for(let i=0;i<maxLen;i++){
    for(const group of groups){
      const item=group[i];
      if(!item)continue;
      if(group===news){
        const before=selected.length;
        add(item);
        if(selected.length>before)pendingNews--;
      }else if(selected.length+pendingNews<target &&
        !guaranteed.has((item.seriesId??item.id).toLowerCase())){
        // If an upcoming novel title also appears in a generic shelf,
        // keep its novelty provenance and reserved position.
        add(item);
      }
    }
  }
  if(selected.length<target){
    // A sparse recommendation pool can still show genuine, unfinished
    // episodes. This is an explicit fallback, not the primary hero source.
    for(const key of ["favorites","resume","next-up"]){
      for(const item of rows.find(row=>row.id===key)?.items??[]){
        if(selected.length>=target)break;
        add(item);
      }
      if(selected.length>=target)break;
    }
  }
  return selected;
}
export function featuredMedia(rows:Shelf[]):MediaItem|null {
  return featuredSlides(rows,1)[0]??null;
}
