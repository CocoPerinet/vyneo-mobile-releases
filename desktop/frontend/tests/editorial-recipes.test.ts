import {describe,it,expect} from "vitest";
import {EDITORIAL_RECIPES,recipeMatches,rotatingEditorial} from "../src/editorial-recipes";
import type {MediaItem} from "../src/types";

const user="a".repeat(32);
function item(n:number,genres:string[],extra:Partial<MediaItem>={}):MediaItem{
  return {
    id:n.toString(16).padStart(32,"0"),
    title:"Titre "+n,type:n%4===0?"Series":"Movie",
    year:2021+n%5,overview:"",genres,
    communityRating:7.7,played:false,isFavorite:n%4===0,
    progress:null,premiereDate:"2025-01-02",
    hasPrimary:true,hasBackdrop:false,seriesName:"",
    ...extra
  };
}
const pool=()=>Array.from({length:105},(_,i)=>{
  const genres=[
    ["Action","Science-fiction"],
    ["Comédie","Romance"],
    ["Animation","Aventure"],
    ["Drame","Crime"],
    ["Documentaire","Histoire"],
    ["Horreur","Thriller"]
  ][i%6];
  return item(i+1,genres);
});

describe("G7x evidence-only local recipe taxonomy",()=>{
  it("ports 45 recipes without inventing a saga or LLM verdict",()=>{
    expect(EDITORIAL_RECIPES.length).toBe(45);
    expect(new Set(EDITORIAL_RECIPES.map(r=>r.key)).size).toBe(45);
    expect(new Set(EDITORIAL_RECIPES.map(r=>r.mode))).toEqual(
      new Set(["genre","mix","kind","period","recent","classic","rated","favourite"]));
  });
  it("normalizes exact aliases and requires BOTH genres for mixes",()=>{
    const sci=EDITORIAL_RECIPES.find(x=>x.key==="mix-scifi-action")!;
    expect(recipeMatches(sci,item(2,["Science-Fiction","Action"]),
      new Date("2026-10-20"))).toBe(true);
    expect(recipeMatches(sci,item(2,["Science-Fiction","Drame"]),
      new Date("2026-10-20"))).toBe(false);
    expect(recipeMatches(sci,item(2,["Science-Fiction","Action"],
      {played:true}),new Date("2026-10-20"))).toBe(false);
  });
  it("filters future releases, unverifiable topics and watched items",()=>{
    const now=new Date("2026-10-20");
    const sci=EDITORIAL_RECIPES.find(x=>x.key==="genre-scifi")!;
    expect(recipeMatches(sci,item(4,["SF"],{year:2027}),now)).toBe(false);
    expect(recipeMatches(sci,item(4,["SF"],{
      premiereDate:"2027-10-21"}),now)).toBe(false);
    expect(recipeMatches(sci,item(4,["Sport"]),now)).toBe(false);
    expect(recipeMatches(sci,item(4,["SF"],{played:true}),now)).toBe(false);
    expect(recipeMatches(sci,item(4,["SF"],{type:"BoxSet"}),now)).toBe(false);
  });
  it("rotates user-scoped 10 evidence-backed rows without repeating cards",()=>{
    const data=pool(),date=new Date("2026-10-20T12:00:00Z");
    const rows=rotatingEditorial(data,user,date);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.length).toBeLessThanOrEqual(10);
    const valid=new Set(data.map(i=>i.id));
    const all=rows.flatMap(r=>r.items.map(i=>i.id));
    expect(new Set(all).size).toBe(all.length);
    expect(all.every(id=>valid.has(id))).toBe(true);
    expect(rows.every(r=>r.items.length>=3&&r.items.length<=5)).toBe(true);
    expect(rotatingEditorial(data,user,date)).toEqual(rows);
    expect(rotatingEditorial(data,user,new Date("2026-10-20T22:00:00Z"))).toEqual(rows);
  });
  it("is stable per day and rejects invalid identity/empty inputs",()=>{
    expect(rotatingEditorial([],user)).toEqual([]);
    expect(()=>rotatingEditorial(pool(),"not-a-user-id"))
      .toThrow("EDITORIAL_SCOPE_INVALID");
    const rows=rotatingEditorial(pool(),user,new Date("2026-10-20"));
    const next=rotatingEditorial(pool(),user,new Date("2026-10-22"));
    expect(rows.map(r=>r.id)).not.toEqual(next.map(r=>r.id));
  });
});
