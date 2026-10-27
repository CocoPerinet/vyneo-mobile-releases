import type {MediaItem} from "./types";

/** Rankings from the already deployed Jellyfin-hosted TMDb proxy.
 * They contain only public TMDb identifiers, never Jellyfin credentials. */
export interface TrendingRank {
  type:"Movie"|"Series";
  tmdbId:string;
  rank:number;
}
const VALID_TMDB=/^[1-9]\d{0,11}$/;

/** Only previously authorized Jellyfin items are eligible for Tendances.
 * TMDb results are ranking evidence, NEVER new catalog entries. */
export function matchTrending(
  items:readonly MediaItem[],rankings:readonly TrendingRank[],
  limit=16
):MediaItem[]{
  if(!Number.isSafeInteger(limit) || limit<1 || limit>48)
    throw new Error("TRENDING_LIMIT_INVALID");
  const allowed=new Map<string,MediaItem>();
  for(const item of items){
    if(!["Movie","Series"].includes(item.type) || item.played ||
      !item.tmdbId || !VALID_TMDB.test(item.tmdbId))continue;
    const key=item.type+":"+item.tmdbId;
    const existing=allowed.get(key);
    // When the user has several authorized editions, prefer one with
    // artwork, without introducing any unauthorized or unplayed guess.
    const artwork=(i:MediaItem)=>Number(i.hasBackdrop)*2+Number(i.hasPrimary);
    if(!existing || artwork(item)>artwork(existing))allowed.set(key,item);
  }
  const results:{Movie:MediaItem[];Series:MediaItem[]}={
    Movie:[],Series:[]
  };
  const used=new Set<string>();
  for(const entry of [...rankings].sort((a,b)=>a.rank-b.rank)){
    if(!VALID_TMDB.test(entry.tmdbId) ||
      !["Movie","Series"].includes(entry.type))continue;
    const matched=allowed.get(entry.type+":"+entry.tmdbId);
    if(!matched || used.has(matched.id.toLowerCase()))continue;
    used.add(matched.id.toLowerCase());
    results[entry.type].push(matched);
  }
  // The native Jellyfin Tendances row mixes movies and series, not a
  // solid block of one type. Fill the remainder from whichever is available.
  const selected:MediaItem[]=[];
  for(let round=0;selected.length<limit;round++){
    let any=false;
    for(const kind of ["Movie","Series"] as const){
      const next=results[kind][round];
      if(!next)continue;
      any=true;selected.push(next);
      if(selected.length>=limit)break;
    }
    if(!any)break;
  }
  return selected;
}
