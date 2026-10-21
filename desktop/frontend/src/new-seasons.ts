import type {MediaItem,LibrarySnapshot,Shelf} from "./types";

export interface RecentSeason {
  seriesId:string;
  seasonId:string;
  number:number;
  premiereDate:string;
}
export type NewBadge={label:string;title:string};
const DAY=86400000;
const SIXTY=60*DAY;
const isAnime=(item:MediaItem)=>[...item.genres,...(item.tags??[])]
  .some(x=>/^(anime|animation)$/i.test(x.trim()));
const release=(iso:string):number=>{
  if(!iso || !/^\d{4}-\d\d-\d\d/.test(iso))return NaN;
  return Date.parse(iso);
};
const within=(iso:string,from:number,now:number)=>
  Number.isFinite(release(iso)) && release(iso)>=from &&
  release(iso)<=now+DAY;
const monthsBefore=(now:Date,count:number):number=>{
  const copy=new Date(now);
  const day=copy.getUTCDate();
  copy.setUTCDate(1);
  copy.setUTCMonth(copy.getUTCMonth()-count);
  const last=new Date(Date.UTC(copy.getUTCFullYear(),
    copy.getUTCMonth()+1,0)).getUTCDate();
  copy.setUTCDate(Math.min(day,last));
  return copy.getTime();
};
export function newBadge(item:MediaItem,
  recentSeasons:readonly RecentSeason[]=[],now=new Date()):NewBadge|null{
  const current=now.getTime();
  const match=recentSeasons
    .filter(s=>s.seriesId.toLowerCase()===(item.type==="Series"
       ?item.id:item.seriesId??"").toLowerCase() &&
      // An episode with no SeasonId cannot safely inherit a badge
      // from the parent series' most recent season.
      (item.type!=="Episode" || (!!item.seasonId &&
        s.seasonId.toLowerCase()===item.seasonId.toLowerCase())) &&
      within(s.premiereDate,current-SIXTY,current))
    .sort((a,b)=>release(b.premiereDate)-release(a.premiereDate))[0];
  if(match){
    if(match.number>1)return {
      label:"Nouvelle saison S"+match.number,
      title:"Saison "+match.number+" diffusée depuis moins de deux mois"
    };
    return {label:isAnime(item)?"Nouvel anime":"Nouvelle série",
      title:"Première saison diffusée depuis moins de deux mois"};
  }
  if(item.type==="Movie" && within(item.premiereDate,
       monthsBefore(now,6),current))
    return {label:"Nouveau film",title:"Film sorti durant les six derniers mois"};
  if(item.type==="Series" && within(item.premiereDate,current-SIXTY,current))
    return {label:isAnime(item)?"Nouvel anime":"Nouvelle série",
      title:"Série sortie depuis moins de deux mois"};
  return null;
}
function isRealEngagement(item:MediaItem):boolean{
  return item.type==="Series" &&
    (item.playedPercentage??0)>=15;
}
export function classifyNewReleases(data:LibrarySnapshot,
  seasons:readonly RecentSeason[]=[],evidence:readonly MediaItem[]=[],
  now=new Date()):{
    newReleases:MediaItem[];nextUp:MediaItem[];
    relevantSeasons:RecentSeason[];
  }{
  const nowMs=now.getTime();
  const bySeries=new Map(evidence.filter(isRealEngagement)
    .map(x=>[x.id.toLowerCase(),x]));
  const matched=new Map<string,{series:MediaItem;season:RecentSeason}>();
  const oldUnstarted=new Set<string>();
  const allSeasons=new Map(seasons.map(s=>[s.seasonId.toLowerCase(),s]));
  for(const ep of data.nextUp){
    if(ep.type!=="Episode" || ep.episodeNumber!==1 || !ep.seriesId ||
      !ep.seasonId)continue;
    const series=bySeries.get(ep.seriesId.toLowerCase());
    if(!series)continue;
    const known=allSeasons.get(ep.seasonId.toLowerCase());
    const aired=release(known?.premiereDate??ep.premiereDate);
    // Jellyfin's vyClassifieSaisonsNextUpSync distinguishes aged E1s:
    // they remain in À suivre, but AFTER actually ongoing episodes.
    // Ignore DateCreated: a library rescan is not an air date.
    if(Number.isFinite(aired) && aired<nowMs-SIXTY)
      oldUnstarted.add(series.id.toLowerCase());
    // Jellyfin may omit Season metadata when S2E1 does have a premiere.
    // Refuse contradictory season data instead of inferring from the series.
    if(!known && seasons.some(s=>s.seriesId.toLowerCase()===
      ep.seriesId!.toLowerCase()))continue;
    const season=known??(ep.seasonNumber!==null &&
      ep.seasonNumber!==undefined?{
        seriesId:ep.seriesId,seasonId:ep.seasonId,
        number:ep.seasonNumber,premiereDate:ep.premiereDate
      }:null);
    if(!season || season.number<2 ||
      (known && ep.seasonNumber!==null &&
        ep.seasonNumber!==undefined &&
        ep.seasonNumber!==known.number) ||
      !within(season.premiereDate,nowMs-SIXTY,nowMs))continue;
    if(season.seriesId.toLowerCase()!==series.id.toLowerCase())continue;
    matched.set(series.id.toLowerCase(),{series,season});
    oldUnstarted.delete(series.id.toLowerCase());
  }
  // Franchises: use exact TMDb collection IDs, not superficial title matches.
  // Jellyfin's vySuitesEtDerives selects only the FIRST unseen part of a saga:
  // never promote parts 2+ while part 1 is still unwatched. Compare all
  // available locally authorized candidates BEFORE filtering by recency.
  const watchedIds=new Set(data.watched.filter(x=>x.played)
    .map(x=>x.id.toLowerCase()));
  const seenCollections=new Set(data.watched.filter(x=>
    x.type==="Movie" && x.played && x.franchiseId).map(x=>x.franchiseId!));
  const candidatesByCollection=new Map<string,Map<string,MediaItem>>();
  for(const film of [...(data.candidates??[]),...data.recent]){
    if(film.type!=="Movie" || film.played ||
      watchedIds.has(film.id.toLowerCase()) || !film.franchiseId ||
      !seenCollections.has(film.franchiseId))continue;
    if(!candidatesByCollection.has(film.franchiseId))
      candidatesByCollection.set(film.franchiseId,new Map());
    candidatesByCollection.get(film.franchiseId)!
      .set(film.id.toLowerCase(),film);
  }
  const chronological=(film:MediaItem):number=>{
    const timestamp=release(film.premiereDate);
    return Number.isFinite(timestamp)?timestamp:
      film.year!==null?Date.UTC(film.year,0,1):-Infinity;
  };
  const sequels:MediaItem[]=[];
  for(const group of candidatesByCollection.values()){
    const first=[...group.values()].sort((a,b)=>
      chronological(a)-chronological(b) ||
      a.title.localeCompare(b.title,"fr"))[0];
    if(first && within(first.premiereDate,nowMs-SIXTY,nowMs))
      sequels.push(first);
  }
  const latest=new Map<string,MediaItem>();
  for(const row of sequels)latest.set(row.id.toLowerCase(),row);
  for(const {series} of matched.values())latest.set(series.id.toLowerCase(),series);
  const output=[...latest.values()].sort((a,b)=>{
    const aDate=matched.get(a.id.toLowerCase())?.season.premiereDate??a.premiereDate;
    const bDate=matched.get(b.id.toLowerCase())?.season.premiereDate??b.premiereDate;
    return release(bDate)-release(aDate);
  }).slice(0,24);
  return {
    newReleases:output,
    // Preserve Jellyfin's source order within each class, moving aged E1s
    // to the end without discarding them or changing ongoing episodes.
    nextUp:[...data.nextUp.filter(ep=>!ep.seriesId ||
      (!matched.has(ep.seriesId.toLowerCase()) &&
       !oldUnstarted.has(ep.seriesId.toLowerCase()))),
    ...data.nextUp.filter(ep=>!!ep.seriesId &&
      !matched.has(ep.seriesId.toLowerCase()) &&
      oldUnstarted.has(ep.seriesId.toLowerCase()))],
    relevantSeasons:[...matched.values()].map(x=>x.season)
  };
}
export function includeNewReleaseShelf(shelves:readonly Shelf[],
  data:LibrarySnapshot,seasons:readonly RecentSeason[],
  evidence:readonly MediaItem[],now=new Date()):Shelf[]{
  const split=classifyNewReleases(data,seasons,evidence,now);
  const next=shelves.map(row=>row.id==="next-up"?
    {...row,items:split.nextUp}:row);
  if(split.newReleases.length){
    const entry:Shelf={id:"new-seasons",title:"Nouvelles saisons et suites",
      items:split.newReleases,kind:"standard"};
    const where=next.findIndex(row=>row.id==="next-up");
    next.splice(where<0?0:where+1,0,entry);
  }
  return next;
}

