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
  const resume=unique(data.resume,16);
  const nextUp=unique(data.nextUp,22);
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
    if(items.length)rows.push({id,title,items:unique(items),kind});
  };
  put("resume","Reprendre la lecture",resume);
  put("next-up","À suivre",nextUp);
  put("for-you",recommendations.personalized?"Pour vous · Des histoires qui vous ressemblent":
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
export function featuredSlides(rows:Shelf[],limit=5):MediaItem[]{
  const max=Math.max(1,Math.min(7,Math.floor(limit)));
  const selected:MediaItem[]=[],used=new Set<string>();
  const add=(item:MediaItem|undefined)=>{
    if(!item || !hasArtwork(item) || used.has(item.id))return;
    used.add(item.id);selected.push(item);
  };
  // Each source contributes one distinct, evidenced candidate first, so the
  // banner never shows five near-identical releases from the same shelf.
  for(const key of ["for-you","top-ten","favorites","resume","next-up"]){
    if(selected.length>=max)break;
    const shelf=rows.find(row=>row.id===key);
    add(shelf?.items.find(item=>item.hasBackdrop) ??
      shelf?.items.find(hasArtwork));
  }
  if(selected.length<max){
    for(const row of rows){
      for(const item of row.items){
        if(selected.length>=max)break;
        add(item);
      }
      if(selected.length>=max)break;
    }
  }
  return selected;
}
export function featuredMedia(rows:Shelf[]):MediaItem|null {
  return featuredSlides(rows,1)[0]??null;
}
