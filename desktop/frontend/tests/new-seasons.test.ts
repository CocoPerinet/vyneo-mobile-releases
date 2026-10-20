import {describe,it,expect} from "vitest";
import {newBadge,classifyNewReleases,includeNewReleaseShelf} from "../src/new-seasons";
import type {MediaItem,LibrarySnapshot,Shelf} from "../src/types";

const id=(n:number)=>n.toString(16).padStart(32,"0");
const now=new Date("2026-10-20T12:00:00.000Z");
function item(n:number,type:MediaItem["type"]="Movie",
  extra:Partial<MediaItem>={}):MediaItem{
  return {id:id(n),title:"Titre "+n,type,year:2026,overview:"",
    genres:["Action"],tags:[],studios:[],communityRating:8,
    isFavorite:false,played:false,progress:null,premiereDate:"2026-09-14",
    hasPrimary:true,hasBackdrop:true,seriesName:"",...extra};
}
const season={seriesId:id(10),seasonId:id(100),number:2,
  premiereDate:"2026-09-15"};
const season1={seriesId:id(11),seasonId:id(101),number:1,
  premiereDate:"2026-09-01"};
const series=item(10,"Series",{playedPercentage:60,premiereDate:"2017-01-01"});
const ep=item(200,"Episode",{seriesId:id(10),seasonId:id(100),
  seasonNumber:2,episodeNumber:1});
const library=(nextUp:MediaItem[],recent:MediaItem[]=[]):LibrarySnapshot=>({
  resume:[],nextUp,favorites:[],watched:[item(20,"Movie",{played:true,
    franchiseId:"112233"})],candidates:[],recent,collections:[]
});
describe("Jellyfin parity: seasons, sequels and novelty badges",()=>{
  it("marks only true season premieres in a 60-day window",()=>{
    expect(newBadge(series,[season],now)?.label).toBe("Nouvelle saison S2");
    expect(newBadge(ep,[season],now)?.label).toBe("Nouvelle saison S2");
    expect(newBadge(item(201,"Episode",{seriesId:id(10),
      seasonId:id(999),episodeNumber:4}),[season],now)).toBeNull();
    expect(newBadge(item(11,"Series",{genres:["Anime"]}),[season1],now)?.label)
      .toBe("Nouvel anime");
    expect(newBadge(item(400,"Movie",{premiereDate:"2026-06-25"}),
      [],now)?.label).toBe("Nouveau film");
    expect(newBadge(item(401,"Movie",{premiereDate:"2011-06-25"}),
      [],now)).toBeNull();
  });
  it("new season is isolated only when S2E1 unstarted AND series engaged",()=>{
    const data=library([ep,item(202,"Episode",{seriesId:id(14),
      episodeNumber:5,seasonId:id(140)})]);
    const outcome=classifyNewReleases(data,[season],[series],now);
    expect(outcome.newReleases.map(x=>x.id)).toEqual([id(10)]);
    expect(outcome.nextUp.map(x=>x.id)).toEqual([id(202)]);
    expect(outcome.relevantSeasons).toEqual([season]);
  });
  it("never misclassifies an unstarted series or episode two as a new season",()=>{
    const noEngagement=item(10,"Series",{playedPercentage:5});
    const notE1=item(200,"Episode",{...ep,episodeNumber:2});
    expect(classifyNewReleases(library([ep]),[season],
      [noEngagement],now).newReleases).toEqual([]);
    expect(classifyNewReleases(library([notE1]),[season],
      [series],now).newReleases).toEqual([]);
  });
  it("requires recent premiere and exact Jellyfin season and series IDs",()=>{
    const old={...season,premiereDate:"2026-03-01"};
    const wrong={...season,seasonId:id(999)};
    expect(classifyNewReleases(library([ep]),[old],[series],now)
      .newReleases).toEqual([]);
    expect(classifyNewReleases(library([ep]),[wrong],[series],now)
      .newReleases).toEqual([]);
  });
  it("only recommends sequels with a shared TMDb franchise ID",()=>{
    const candidate=item(22,"Movie",{franchiseId:"112233",
      premiereDate:"2026-10-01"});
    const unrelated=item(23,"Movie",{franchiseId:"778899"});
    const result=classifyNewReleases(library([],[
      candidate,unrelated]),[],[],now);
    expect(result.newReleases.map(x=>x.id)).toEqual([id(22)]);
    const old=item(24,"Movie",{franchiseId:"112233",
      premiereDate:"2019-04-01"});
    expect(classifyNewReleases(library([],[old]),[],[],now)
      .newReleases).toEqual([]);
  });
  it("adds the adaptive shelf only when backed by recent real evidence",()=>{
    const row:Shelf={id:"next-up",title:"À suivre",items:[ep]};
    const newRows=includeNewReleaseShelf([row],library([ep]),
      [season],[series],now);
    expect(newRows.map(x=>x.id)).toEqual(["next-up","new-seasons"]);
    expect(newRows[0].items).toHaveLength(0);
    expect(includeNewReleaseShelf([row],library([]),
      [season],[series],now)[0].items).toHaveLength(0);
  });
});

