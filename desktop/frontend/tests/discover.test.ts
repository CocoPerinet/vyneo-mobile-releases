import {describe,it,expect} from "vitest";
import {buildShelves,featuredMedia,featuredSlides} from "../src/discover";
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
    expect(featuredSlides(rows,100)).toHaveLength(7);
    const hidden=media(800,[],{hasBackdrop:false,hasPrimary:false});
    expect(featuredSlides([{id:"x",title:"x",items:[hidden]}])).toEqual([]);
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
});
