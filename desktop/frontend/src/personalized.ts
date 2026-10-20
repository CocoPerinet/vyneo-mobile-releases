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
const GUID=/^[a-f0-9]{32}$/i;
const unaccent=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const stop=new Set(("avec dans pour quand mais alors plus moins tout tous toutes leur leurs notre votre cette " +
  "chez apres avant pendant entre sans depuis comme aussi ainsi etre avoir sont dont elle elles nous vous " +
  "cest cela celui ceux cette jeune histoire film serie episode annees monde vie jour jours " +
  "the and for with from that this they them their into about while when have where after " +
  "before some over under from then also life world movie story season series").split(" "));
function unique(rows:readonly MediaItem[],limit:number):MediaItem[]{
  const seen=new Set<string>(),out:MediaItem[]=[];
  for(const row of rows){
    if(!GUID.test(row.id)||seen.has(row.id.toLowerCase()))continue;
    seen.add(row.id.toLowerCase());out.push(row);
    if(out.length===limit)break;
  }
  return out;
}
function words(value:string,max=110):string[]{
  return unaccent(value).match(/[a-z]{4,}/g)?.filter(w=>!stop.has(w)).slice(0,max)??[];
}
function facets(item:MediaItem):Map<string,number>{
  const f=new Map<string,number>();
  const add=(key:string,weight:number)=>{
    f.set(key,Math.min(4,(f.get(key)??0)+weight));
  };
  for(const token of words(item.overview,110))add("p:"+token,.6);
  for(const tag of (item.tags??[]).slice(0,12))
    for(const token of words(tag,6))add("t:"+token,2.2);
  for(const studio of (item.studios??[]).slice(0,4))
    for(const token of words(studio,4))add("s:"+token,2);
  for(const genre of item.genres.slice(0,10)){
    const key=unaccent(genre).replace(/[^a-z0-9]+/g," ").trim();
    if(key)add("g:"+key,1.5);
  }
  return f;
}
interface IndexDocument {
  item:MediaItem;
  vectors:Map<string,number>;
  norm:number;
}
function featureIndex(items:readonly MediaItem[]):Map<string,IndexDocument>{
  const raw=items.map(item=>({item,features:facets(item)}));
  const df=new Map<string,number>();
  for(const r of raw)for(const key of r.features.keys())
    df.set(key,(df.get(key)??0)+1);
  const documents=new Map<string,IndexDocument>();
  for(const row of raw){
    const vectors=new Map<string,number>();
    let sum=0;
    for(const [key,count] of row.features){
      // Popular genres (Action/Adventure) carry little evidence.
      const idf=Math.log(1+(raw.length+1)/((df.get(key)??0)+1));
      const weight=count*idf;
      vectors.set(key,weight);sum+=weight*weight;
    }
    documents.set(row.item.id,{item:row.item,vectors,norm:Math.sqrt(sum)});
  }
  return documents;
}
function resemblance(a:IndexDocument,b:IndexDocument):number{
  if(a.norm===0 || b.norm===0)return 0;
  let product=0,plot=0,genres=0,tags=0;
  for(const [feature,weight] of a.vectors){
    const other=b.vectors.get(feature);
    if(other===undefined)continue;
    product+=weight*other;
    if(feature.startsWith("p:"))plot++;
    if(feature.startsWith("g:"))genres++;
    if(feature.startsWith("t:")||feature.startsWith("s:"))tags++;
  }
  // Never infer personal taste from just "Action" or "Adventure".
  if(!(plot>=2 || (plot>=1 && genres>=1) ||
       (tags>=1 && (genres>=1 || plot>=1)) || genres>=2))
    return 0;
  return product/(a.norm*b.norm);
}
function available(item:MediaItem,now:Date):boolean{
  if(item.played || !["Movie","Series"].includes(item.type))return false;
  if(item.year!==null && item.year>now.getUTCFullYear())return false;
  const release=item.premiereDate.slice(0,10);
  return !(/^\d{4}-\d{2}-\d{2}$/.test(release) &&
    release>now.toISOString().slice(0,10));
}
// Per-session hybrid content similarity. It never calls an LLM or stores a
// profile, and explains suggestions only through specific existing titles.
export function recommendNative(data:LibrarySnapshot,now=new Date(),
    maxResults=12):NativeRecommendations{
  if(!Number.isSafeInteger(maxResults)||maxResults<1||maxResults>24||
     !Number.isFinite(now.getTime()))throw new Error("RECOMMENDER_INVALID");
  const favorites=unique(data.favorites,80);
  const favoriteIds=new Set(favorites.map(x=>x.id));
  const watched=unique(data.watched.filter(x=>x.played &&
    !favoriteIds.has(x.id)),96);
  const seeds=[...favorites,...watched];
  const excludes=new Set([
    ...favorites.map(x=>x.id),...data.watched.map(x=>x.id),
    ...data.resume.map(x=>x.id),...data.nextUp.map(x=>x.id),
    ...data.nextUp.map(x=>x.seriesId).filter((id):id is string=>!!id)
  ]);
  const candidates=unique([...(data.candidates??[]),...data.recent],512)
    .filter(x=>available(x,now)&&!excludes.has(x.id));
  if(!candidates.length)return {items:[],personalized:false};
  const vectors=featureIndex(unique([...seeds,...candidates],720));
  type Ranked={item:MediaItem;score:number;anchor:MediaItem|null;
    basis:NativeRecommendation["basis"]};
  const scored:Ranked[]=candidates.map(item=>{
    const current=vectors.get(item.id)!;
    let best=0,anchor:MediaItem|null=null,basis:Ranked["basis"]="discovery";
    for(const seed of seeds){
      const profile=vectors.get(seed.id);
      if(!profile || seed.type!==item.type)continue;
      const similarity=resemblance(current,profile);
      const boosted=similarity*(favoriteIds.has(seed.id)?1.35:1);
      if(boosted>best){best=boosted;anchor=seed;
        basis=favoriteIds.has(seed.id)?"favorite":"watched";}
    }
    if(best<.13){best=0;anchor=null;basis="discovery";}
    // Ratings and freshness are tie-breakers, not substitutes for affinity.
    return {item,anchor,basis,
      score:best*100+(item.communityRating??5)*.35+
        Math.max(0,(item.year??now.getUTCFullYear()-15)-
          (now.getUTCFullYear()-12))*.13};
  });
  const personalized=scored.some(r=>r.anchor!==null);
  const pool=personalized?scored.filter(r=>r.anchor!==null):scored;
  const selected:NativeRecommendation[]=[];
  const reusedAnchor=new Map<string,number>();
  const reusedGenres=new Map<string,number>();
  const types=new Map<string,number>();
  while(pool.length && selected.length<maxResults){
    pool.sort((a,b)=>{
      const adjusted=(r:Ranked)=>{
        const repeated=r.item.genres.reduce((sum,g)=>
          sum+Math.max(0,(reusedGenres.get(unaccent(g))??0)-1),0);
        return r.score-(r.anchor?(reusedAnchor.get(r.anchor.id)??0)*8:0)-
          repeated*1.6-(types.get(r.item.type)??0)*1.2;
      };
      return adjusted(b)-adjusted(a) ||
        (b.item.communityRating??0)-(a.item.communityRating??0) ||
        a.item.id.localeCompare(b.item.id);
    });
    const winner=pool.shift()!;
    const title=winner.anchor?.title.replace(/[<>\u0000-\u001f]/g,"").slice(0,64);
    selected.push({item:winner.item,basis:winner.basis,
      reason:title?
        (winner.basis==="favorite"?"Proche de votre favori « ":"Dans l’esprit de « ")+title+" »"
        :null});
    types.set(winner.item.type,(types.get(winner.item.type)??0)+1);
    for(const genre of winner.item.genres)
      reusedGenres.set(unaccent(genre),(reusedGenres.get(unaccent(genre))??0)+1);
    if(winner.anchor)reusedAnchor.set(winner.anchor.id,
      (reusedAnchor.get(winner.anchor.id)??0)+1);
  }
  return {items:selected,personalized};
}
