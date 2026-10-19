import {describe,it,expect} from "vitest";
import {buildShelves,featuredMedia} from "../src/discover";
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
    expect(names.some(n=>n.startsWith("Pour vous"))).toBe(true);
    expect(names.some(n=>n.startsWith("Top 10"))).toBe(true);
    expect(names).toContain("Sagas et collections");
    expect(names.some(n=>n.includes("science-fiction") || n.includes("Action") || n.includes("Bien notés"))).toBe(true);
    expect(rows.some(r=>r.id.startsWith("editorial-"))).toBe(true);
    expect(rows.find(r=>r.kind==="top10")?.items).toHaveLength(10);
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
  it("shows no imaginary rankings when catalogue is empty",()=>{
    const zero:LibrarySnapshot={
      recent:[],resume:[],nextUp:[],favorites:[],watched:[],collections:[]
    };
    expect(buildShelves(zero,"a".repeat(32))).toEqual([]);
    expect(featuredMedia([])).toBeNull();
  });
});
