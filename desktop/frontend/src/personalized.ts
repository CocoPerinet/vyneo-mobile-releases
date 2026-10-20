import type {LibrarySnapshot,MediaItem} from "./types";

export interface NativeRecommendation{
  item:MediaItem;
  reason:string|null;
  basis:"favorite"|"watched"|"discovery";
}
export interface NativeRecommendations{
  items:NativeRecommendation[];
  personalized:boolean;
}
function unique(rows:readonly MediaItem[],limit:number):MediaItem[]{
  const seen=new Set<string>(),out:MediaItem[]=[];
  for(const item of rows){
    if(!/^[a-f0-9]{32}$/i.test(item.id) || seen.has(item.id))continue;
    seen.add(item.id);out.push(item);
    if(out.length>=limit)break;
  }
  return out;
}
const canon=(value:string)=>value.normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").toLowerCase().trim()
  .replace(/[^a-z0-9]+/g," ");
interface GenreCount{count:number;label:string;}
function profile(rows:readonly MediaItem[]):Map<string,GenreCount>{
  const counts=new Map<string,GenreCount>();
  for(const row of rows){
    const used=new Set<string>();
    for(const value of row.genres.slice(0,12)){
      const key=canon(value);
      if(!key || used.has(key))continue;
      used.add(key);
      const current=counts.get(key);
      counts.set(key,{count:Math.min(1000,(current?.count??0)+1),
        label:current?.label??value.slice(0,70)});
    }
  }
  return counts;
}
function candidateValid(item:MediaItem,now:Date):boolean{
  if(item.played || (item.type!=="Movie" && item.type!=="Series"))
    return false;
  if(item.year!==null && item.year>now.getUTCFullYear())return false;
  const date=item.premiereDate.slice(0,10);
  if(/^\d{4}-\d{2}-\d{2}$/.test(date) &&
     date>now.toISOString().slice(0,10))return false;
  return true;
}
// Metadata-only, per-session subset of G7w: never sends viewing
// history or favorites to a model, backend, log or persistent cache.
export function recommendNative(data:LibrarySnapshot,now=new Date(),
                                maxResults=12):NativeRecommendations{
  if(!Number.isSafeInteger(maxResults) || maxResults<1 || maxResults>24 ||
     !Number.isFinite(now.getTime()))
    throw new Error("RECOMMENDER_INVALID");
  const watched=unique(data.watched.filter(row=>row.played),192);
  const favorites=unique(data.favorites,128);
  const watchedCounts=profile(watched.length>=3?watched:[]);
  const favoriteCounts=profile(favorites);
  const exclude=new Set<string>([
    ...watched.map(i=>i.id),...favorites.map(i=>i.id),
    ...data.resume.map(i=>i.id),...data.nextUp.map(i=>i.id),
    ...data.nextUp.map(i=>i.seriesId).filter((id):id is string=>!!id)
  ]);
  const candidate=unique([
    ...(data.candidates??[]),...data.recent
  ],512).filter(item=>candidateValid(item,now)&&!exclude.has(item.id));
  type Rated={item:MediaItem;basis:NativeRecommendation["basis"];
    reason:string|null;score:number;genres:Set<string>};
  const rated:Rated[]=candidate.map(item=>{
    const names=new Set(item.genres.map(canon).filter(Boolean));
    let winning:{basis:"favorite"|"watched";label:string;weight:number}|null=null;
    let affinity=0;
    for(const name of names){
      const f=favoriteCounts.get(name),w=watchedCounts.get(name);
      if(f){
        const weight=f.count*5;
        affinity+=weight;
        if(!winning || weight>winning.weight)winning={
          basis:"favorite",label:f.label,weight
        };
      }
      if(w){
        const weight=w.count*3;
        affinity+=weight;
        if(!winning || weight>winning.weight)winning={
          basis:"watched",label:w.label,weight
        };
      }
    }
    const proof=winning as typeof winning;
    return {
      item,genres:names,
      score:affinity+(item.communityRating??0)*.25+
        (item.year??1990)/1000,
      basis:proof?.basis??"discovery",
      reason:proof ?proof.basis==="favorite"
        ?"Genre de vos favoris : "+proof.label
        :"Selon vos visionnages : "+proof.label:null
    };
  });
  // "Selon vos goûts" is only displayed when a real, currently
  // visible candidate shares a verifiable watched/favorite genre.
  const personalized=rated.some(i=>i.basis!=="discovery");
  const pool=personalized?rated.filter(i=>i.basis!=="discovery"):rated;
  const output:NativeRecommendation[]=[];
  const usedGenres=new Map<string,number>(),types=new Map<string,number>();
  while(pool.length && output.length<maxResults){
    pool.sort((a,b)=>{
      const adjusted=(r:Rated)=>{
        let penalty=0;
        for(const genre of r.genres){
          const repetitions=usedGenres.get(genre)??0;
          penalty+=Math.max(0,repetitions-1)*2;
        }
        penalty+=(types.get(r.item.type)??0)*1.6;
        return r.score-penalty;
      };
      return adjusted(b)-adjusted(a)||
        (b.item.communityRating??0)-(a.item.communityRating??0) ||
        a.item.id.localeCompare(b.item.id);
    });
    const best=pool.shift()!;
    output.push({item:best.item,reason:best.reason,basis:best.basis});
    types.set(best.item.type,(types.get(best.item.type)??0)+1);
    for(const genre of best.genres)
      usedGenres.set(genre,(usedGenres.get(genre)??0)+1);
  }
  return {items:output,personalized};
}
