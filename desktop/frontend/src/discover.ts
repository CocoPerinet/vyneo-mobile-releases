import type {LibrarySnapshot,MediaItem,Shelf} from "./types";

const unique=(items:MediaItem[],limit=30):MediaItem[]=>{
  const used=new Set<string>();
  return items.filter(item=>{
    if(used.has(item.id))return false;
    used.add(item.id);return true;
  }).slice(0,limit);
};
function weekNumber(now:Date):number{
  // Week index changes only once per seven days (UTC, deterministic).
  return Math.floor(now.getTime()/604800000);
}
function hash(seed:string):number{
  let h=2166136261;
  for(const ch of seed){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return h>>>0;
}
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
    .filter(item=>item.communityRating!==null)
    .sort((a,b)=>(b.communityRating??0)-(a.communityRating??0) ||
      a.title.localeCompare(b.title)).slice(0,10);
  const availableGenres=[...new Set(recent.flatMap(item=>item.genres))]
    .filter(g=>recent.filter(i=>i.genres.includes(g)).length>=3)
    .sort();
  const offset=hash(uid+":"+weekNumber(now))%
    Math.max(1,availableGenres.length);
  const rotated=availableGenres.slice(offset)
    .concat(availableGenres.slice(0,offset)).slice(0,4);
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
  put("top-ten","Top 10 les mieux notés de votre bibliothèque",
    rated,"top10");
  for(const [i,genre] of rotated.entries()){
    put("genre-"+i,
      "Cette semaine · "+genre,
      recent.filter(item=>item.genres.includes(genre)).slice(0,20));
  }
  put("universes","Sagas et collections",collections,"universe");
  return rows;
}
export function featuredMedia(rows:Shelf[]):MediaItem|null {
  for(const key of ["for-you","movies","series","favorites","resume"]){
    const item=rows.find(r=>r.id===key)?.items.find(i=>i.hasBackdrop) ??
      rows.find(r=>r.id===key)?.items[0];
    if(item)return item;
  }
  return null;
}
