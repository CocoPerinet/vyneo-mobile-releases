import type {LibrarySnapshot,MediaItem,Shelf} from "./types";
import {rotatingEditorial} from "./editorial-recipes";
import {hasArtwork} from "./artwork";

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
  const watched=unique(data.watched,96);
  const movie=recent.filter(item=>item.type==="Movie");
  const series=recent.filter(item=>item.type==="Series");
  const freq=new Map<string,number>();
  for(const item of watched){
    for(const genre of item.genres){
      freq.set(genre,(freq.get(genre)??0)+1);
    }
  }
  for(const item of favorites){
    for(const genre of item.genres){
      freq.set(genre,(freq.get(genre)??0)+2);
    }
  }
  const seen=new Set(watched.map(item=>item.id));
  const weights=(item:MediaItem):number=>
    item.genres.reduce((sum,g)=>sum+(freq.get(g)??0),0)+
    (item.communityRating??0)/5;
  const recommended=recent
    .filter(item=>!seen.has(item.id) && !item.played)
    .sort((a,b)=>weights(b)-weights(a) || a.id.localeCompare(b.id));
  const withReasons=freq.size>0 && recommended.some(item=>weights(item)>0);
  const rated=recent
    .filter(item=>item.communityRating!==null && !item.played)
    .sort((a,b)=>(b.communityRating??0)-(a.communityRating??0) ||
      a.title.localeCompare(b.title)).slice(0,10);
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
  put("for-you",withReasons?"Pour vous · Selon vos goûts":
    "À découvrir dans votre bibliothèque",recommended.slice(0,24));
  put("movies","Films récemment ajoutés",movie);
  put("series","Séries récemment ajoutées",series);
  put("favorites","Dans votre liste",favorites);
  put("top-ten","Top 10 les mieux notés parmi vos nouveautés",
    rated,"top10");
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
  for(const key of ["for-you","movies","series","favorites","resume"]){
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
