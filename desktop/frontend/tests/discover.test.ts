import {describe,it,expect} from "vitest";
import {buildShelves,featuredMedia,featuredSlides,
  orderHomeShelves} from "../src/discover";
import type {MediaItem,LibrarySnapshot} from "../src/types";

const id=(n:number)=>n.toString(16).padStart(32,"0");
function media(n:number,genres:string[],props:Partial<MediaItem>={}):MediaItem{
  return {
    id:id(n),title:"Titre "+n,type:"Movie",year:2020+n%7,
    overview:"Description de test",genres,communityRating:5+n%5,
    isFavorite:false,played:false,progress:null,
    premiereDate:"2026-10-01",hasPrimary:true,hasBackdrop:n%2===0,
    seriesName:"",...props
  };
}
function sample():LibrarySnapshot{
  const recent=Array.from({length:25},(_,i)=>
    media(i+1,i%2?["Action"]:["Science-fiction"]));
  return {
    recent,resume:[recent[0]],nextUp:[],
    favorites:[recent[2]],
    watched:[media(201,["Science-fiction"],{played:true})],
    collections:[media(301,["Saga"],{type:"BoxSet"})]
  };
}
describe("Vynéo native shelves are metadata-driven and deterministic",()=>{
  it("provides an editorial-looking home without claiming LLM output",()=>{
    const rows=buildShelves(sample(),"a".repeat(32),new Date("2026-10-20"));
    const names=rows.map(r=>r.title);
    expect(names).toContain("Reprendre la lecture");
    expect(names.some(n=>n.startsWith("Pour vous") || n.startsWith("À explorer"))).toBe(true);
    expect(names.some(n=>n.includes("Sorties récentes"))).toBe(true);
    expect(names.some(n=>n.includes("récemment ajoutés"))).toBe(false);
    expect(names).toContain("Sagas et collections");
    expect(names.some(n=>n.includes("science-fiction") || n.includes("Action") || n.includes("Bien notés"))).toBe(true);
    expect(rows.some(r=>r.id.startsWith("editorial-"))).toBe(true);
    expect(rows.find(r=>r.id==="top-ten")?.items.length).toBeLessThanOrEqual(10);
    expect(rows.find(r=>r.id==="top-ten")?.items.every(i=>(i.year??0)>=2024)).toBe(true);
    expect(featuredMedia(rows)?.id).toMatch(/^[a-f0-9]{32}$/);
    expect(names.join("|")).not.toMatch(/IA locale|LLM|ChatGPT/);
  });
  it("keeps the verified Jellyfin home order despite out-of-order async shelves",()=>{
    const mk=(id:string)=>({id,title:id,items:[media(900,[])]});
    const shuffled=[
      mk("top-ten"),mk("editorial-b"),mk("for-you"),
      mk("new-seasons"),mk("trending"),mk("next-up"),
      mk("favorites"),mk("resume"),mk("editorial-a")
    ];
    const sorted=orderHomeShelves(shuffled);
    expect(sorted.map(x=>x.id)).toEqual([
      "resume","next-up","new-seasons","trending","for-you",
      "top-ten","favorites","editorial-b","editorial-a"
    ]);
    expect(shuffled[0].id).toBe("top-ten");
    expect(orderHomeShelves(sorted).map(x=>x.id))
      .toEqual(sorted.map(x=>x.id));
  });
  it("never creates missing core shelves or reorders editorial shelves",()=>{
    const mk=(id:string)=>({id,title:id,items:[media(900,[])]});
    const rows=[mk("editorial-z"),mk("for-you"),
      mk("editorial-a"),mk("favorites")];
    expect(orderHomeShelves(rows).map(x=>x.id))
      .toEqual(["for-you","favorites","editorial-z","editorial-a"]);
  });
  it("is stable within a day and never incorporates unrelated items",()=>{
    const data=sample(),user="b".repeat(32);
    const first=buildShelves(data,user,new Date("2026-10-20T08:00:00Z"));
    const second=buildShelves(data,user,new Date("2026-10-20T21:00:00Z"));
    expect(first.map(r=>r.id)).toEqual(second.map(r=>r.id));
    const valid=new Set([...data.recent,...data.resume,...data.watched,
      ...data.nextUp,...data.favorites,...data.collections].map(x=>x.id));
    expect(first.every(s=>s.items.every(item=>valid.has(item.id)))).toBe(true);
  });
  it("selects distinct real-art hero slides across editorial sources",()=>{
    const rows=buildShelves(sample(),"a".repeat(32),new Date("2026-10-20"));
    const slides=featuredSlides(rows,5);
    expect(slides.length).toBeGreaterThanOrEqual(2);
    expect(slides.length).toBeLessThanOrEqual(5);
    expect(new Set(slides.map(item=>item.id)).size).toBe(slides.length);
    expect(slides.every(item=>item.hasBackdrop || item.hasPrimary)).toBe(true);
    expect(featuredSlides(rows,5).map(item=>item.id))
      .toEqual(slides.map(item=>item.id));
    expect(featuredSlides(rows,100).length).toBeGreaterThan(7);
    expect(featuredSlides(rows,100).length).toBeLessThanOrEqual(32);
    const hidden=media(800,[],{hasBackdrop:false,hasPrimary:false});
    expect(featuredSlides([{id:"x",title:"x",items:[hidden]}])).toEqual([]);
  });
  it("matches the Jellyfin sixteen-slide target with round-robin curation",()=>{
    const news=Array.from({length:3},(_,i)=>media(1000+i,["Action"]));
    const trends=Array.from({length:25},(_,i)=>media(1100+i,["Action"]));
    const suggestions=Array.from({length:25},(_,i)=>media(1200+i,["Drame"]));
    const editorial=Array.from({length:25},(_,i)=>media(1300+i,["Histoire"]));
    const rows=[
      {id:"new-seasons",title:"Nouvelles saisons et suites",items:news},
      {id:"top-ten",title:"Tendances",items:trends},
      {id:"for-you",title:"Pour vous",items:suggestions},
      {id:"editorial-a",title:"Éditorial",items:editorial}
    ];
    const result=featuredSlides(rows);
    expect(result).toHaveLength(16);
    expect(result.slice(0,4).map(x=>x.id)).toEqual([
      news[0].id,trends[0].id,suggestions[0].id,editorial[0].id
    ]);
    expect(result).toEqual(expect.arrayContaining(news));
    expect(featuredSlides(rows).map(x=>x.id))
      .toEqual(featuredSlides(rows).map(x=>x.id));
  });
  it("reserves the novelty source when its film also appears in top ten",()=>{
    const news=[media(1380,[]),media(1381,[])];
    const trends=[media(1390,[]),news[1],media(1392,[])];
    const slides=featuredSlides([
      {id:"new-seasons",title:"Nouvelles saisons et suites",items:news},
      {id:"top-ten",title:"Tendance",items:trends}
    ],4);
    expect(slides.map(x=>x.id)).toEqual([
      news[0].id,trends[0].id,news[1].id,trends[2].id
    ]);
  });
  it("never cuts genuine new seasons to make room for generic recommendations",()=>{
    const news=Array.from({length:19},(_,i)=>media(1400+i,["Drame"]));
    const generic=Array.from({length:40},(_,i)=>media(1600+i,["Drame"]));
    const slides=featuredSlides([
      {id:"new-seasons",title:"Nouvelles saisons et suites",items:news},
      {id:"top-ten",title:"Tendances",items:generic}
    ]);
    expect(slides).toHaveLength(19);
    expect(slides.map(x=>x.id)).toEqual(news.map(x=>x.id));
  });
  it("excludes already watched heroes and duplicate episodes of one series",()=>{
    const ep1=media(1701,[],{type:"Episode",
      seriesId:id(1750),played:false,hasBackdrop:true});
    const ep2=media(1702,[],{type:"Episode",
      seriesId:id(1750),played:false,hasBackdrop:true});
    const watched=media(1703,[],{played:true,hasBackdrop:true});
    const film=media(1704,[],{hasBackdrop:true});
    const slides=featuredSlides([
      {id:"for-you",title:"Pour vous",items:[watched,ep1,ep2,film]}
    ]);
    expect(slides.map(x=>x.id)).toEqual([ep1.id,film.id]);
  });
  it("never confuses an old movie recently added with a recent release",()=>{
    const fresh=[media(503,["Action"],{
      year:2026,communityRating:8.6,premiereDate:"2026-02-01"
    }),media(504,["Drama"],{year:2025,communityRating:8.1})];
    const old=media(501,["Action"],{
      year:1999,communityRating:10,premiereDate:"2026-10-20"
    });
    const data:LibrarySnapshot={...sample(),recent:[old,...fresh],
      candidates:[media(505,["Thriller"],{year:2024,communityRating:8.3})]};
    const rows=buildShelves(data,"a".repeat(32),new Date("2026-10-20"));
    expect(rows.map(x=>x.title)).not.toContain("Films récemment ajoutés");
    expect(rows.map(x=>x.title)).not.toContain("Séries récemment ajoutées");
    const selected=rows.find(x=>x.id==="top-ten")!;
    expect(selected.title).toBe("Les mieux notés · Sorties récentes");
    expect(selected.items.map(i=>i.id)).not.toContain(old.id);
    expect(selected.items.map(i=>i.id)).toEqual(
      expect.arrayContaining(fresh.map(i=>i.id)));
    expect(selected.items.every(i=>(i.year??0)>=2024)).toBe(true);
  });
  it("filters stale completed items from Reprendre even without Played flag",()=>{
    const r1=media(300,[ "Drame" ],{progress:98,played:false});
    const r2=media(301,[ "Drame" ],{progress:100,played:true});
    const r3=media(302,[ "Drame" ],{progress:48,played:false});
    const r4=media(303,[ "Drame" ],{progress:94.9,played:false});
    const r5=media(304,[ "Drame" ],{progress:null,played:false});
    const rows=buildShelves({...sample(),resume:[r1,r2,r3,r4,r5]},
      "a".repeat(32),new Date("2026-10-20"));
    expect(rows.find(x=>x.id==="resume")?.items.map(x=>x.id))
      .toEqual([r3.id,r4.id,r5.id]);
  });
  it("shows no imaginary rankings when catalogue is empty",()=>{
    const zero:LibrarySnapshot={
      recent:[],resume:[],nextUp:[],favorites:[],watched:[],collections:[]
    };
    expect(buildShelves(zero,"a".repeat(32))).toEqual([]);
    expect(featuredMedia([])).toBeNull();
  });
  it("matches real Jellyfin A/B parity: one resumed episode per show, no repeat in NextUp",()=>{
    const southPark=id(1900),gotham=id(1901),vincenzo=id(1902);
    const resumeOne=media(1903,["Comédie"],{type:"Episode",
      title:"South Park",seriesId:southPark,seasonNumber:5,
      episodeNumber:1,progress:15});
    const resumeTwo=media(1904,["Comédie"],{type:"Episode",
      title:"South Park",seriesId:southPark,seasonNumber:5,
      episodeNumber:2,progress:35});
    const newSouthPark=media(1905,["Comédie"],{type:"Episode",
      title:"South Park",seriesId:southPark,seasonNumber:28,
      episodeNumber:2});
    const continueGotham=media(1906,["Crime"],{type:"Episode",
      title:"Gotham",seriesId:gotham,seasonNumber:1,
      episodeNumber:8});
    const continueVincenzo=media(1907,["Drame"],{type:"Episode",
      title:"Vincenzo",seriesId:vincenzo,seasonNumber:1,
      episodeNumber:8});
    const movie=media(1908,["Action"],{progress:52});
    const rows=buildShelves({...sample(),
      resume:[movie,resumeOne,resumeTwo],
      nextUp:[newSouthPark,continueGotham,continueVincenzo]
    },id(43),new Date("2026-10-25"));
    expect(rows.find(x=>x.id==="resume")?.items.map(x=>x.id))
      .toEqual([movie.id,resumeOne.id]);
    expect(rows.find(x=>x.id==="next-up")?.items.map(x=>x.id))
      .toEqual([continueGotham.id,continueVincenzo.id]);
    // Legacy resume endpoints can omit SeriesId while NextUp has it.
    const missingResumeId=media(1915,["Comédie"],{type:"Episode",
      title:"S05E01",seriesId:null,seriesName:"South Park",progress:30});
    const namedNextUp=media(1916,["Comédie"],{type:"Episode",
      title:"S28E02",seriesId:southPark,seriesName:" South Park "});
    const filtered=buildShelves({...sample(),resume:[missingResumeId],
      nextUp:[namedNextUp,continueGotham]},id(43),new Date("2026-10-25"));
    expect(filtered.find(x=>x.id==="next-up")?.items.map(x=>x.id))
      .toEqual([continueGotham.id]);
    const missingNextUpId=media(1917,["Comédie"],{type:"Episode",
      title:"S28E02",seriesId:null,seriesName:"South Park"});
    const otherDirection=buildShelves({...sample(),resume:[resumeOne],
      nextUp:[missingNextUpId,continueVincenzo]},id(43),new Date("2026-10-25"));
    expect(otherDirection.find(x=>x.id==="next-up")?.items.map(x=>x.id))
      .toEqual([continueVincenzo.id]);
    // Distinct known GUIDs remain independent despite the same display name.
    const bothIds=buildShelves({...sample(),resume:[{
      ...resumeOne,seriesName:"South Park"
    }],nextUp:[{
      ...namedNextUp,seriesId:id(1918),seriesName:"South Park"
    }]},id(43),new Date("2026-10-25"));
    expect(bothIds.find(x=>x.id==="next-up")?.items.map(x=>x.id))
      .toEqual([namedNextUp.id]);
    // An identically named item from a different series is NOT hidden.
    const independent=media(1909,["Comédie"],{type:"Episode",
      title:"South Park",seriesId:id(1910)});
    const separate=buildShelves({...sample(),resume:[resumeOne],
      nextUp:[newSouthPark,independent]},id(43),new Date("2026-10-25"));
    expect(separate.find(x=>x.id==="next-up")?.items.map(x=>x.id))
      .toEqual([independent.id]);
    // A stale, almost-complete episode cannot hide the show's real NextUp.
    const stale=media(1911,["Comédie"],{type:"Episode",
      title:"South Park",seriesId:southPark,progress:99,played:false});
    const completed=buildShelves({...sample(),resume:[stale],
      nextUp:[newSouthPark]},id(43),new Date("2026-10-25"));
    expect(completed.find(x=>x.id==="next-up")?.items.map(x=>x.id))
      .toEqual([newSouthPark.id]);
  });

});
