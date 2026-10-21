import {describe,it,expect} from "vitest";
import {matchTrending,type TrendingRank} from "../src/trending";
import type {MediaItem} from "../src/types";
const id=(n:number)=>n.toString(16).padStart(32,"0");
const film=(n:number,type:"Movie"|"Series"="Movie",
 patch:Partial<MediaItem>={}):MediaItem=>({
  id:id(n),title:"Item "+n,type,year:2026,
  overview:"",genres:[],communityRating:8,
  isFavorite:false,played:false,progress:null,
  hasPrimary:true,hasBackdrop:true,premiereDate:"2026-10-01",
  seriesName:"",tmdbId:String(n),...patch
});
const rank=(n:number,type:"Movie"|"Series"="Movie",
 position=n):TrendingRank=>({tmdbId:String(n),type,rank:position});
describe("pinned TMDb trends can only rank previously authorized Jellyfin media",()=>{
 it("interleaves public movie and series ranks while preserving each rank order",()=>{
  const rows=[film(12,"Series"),film(3),film(11,"Series"),
    film(2),film(1)];
  const ranks=[rank(3,"Movie",3),rank(2,"Movie",2),
    rank(1,"Movie",1),rank(12,"Series",2),rank(11,"Series",1)];
  expect(matchTrending(rows,ranks).map(x=>x.id))
    .toEqual([id(1),id(11),id(2),id(12),id(3)]);
 });
 it("does not turn unowned TMDb results into library cards",()=>{
  expect(matchTrending([film(1)],[rank(50),rank(1)]))
    .toEqual([film(1)]);
 });
 it("refuses watched, malformed and incorrectly typed metadata",()=>{
  const entries=[film(1,"Movie",{played:true}),
    film(2,"Movie",{tmdbId:"malicious<script>"}),
    film(3,"Series"),film(4,"Series",{tmdbId:"3"})];
  const result=matchTrending(entries,[rank(1),rank(2),
    rank(3),rank(3,"Series")]);
  expect(result.map(x=>x.id)).toEqual([id(4)]);
 });
 it("chooses the authorized edition with a backdrop, without duplicate IDs",()=>{
  const duplicate=film(2,"Movie",{id:id(20),hasBackdrop:false});
  const better=film(2,"Movie",{id:id(21),hasBackdrop:true});
  const out=matchTrending([duplicate,better,film(3)],
    [rank(2,"Movie",1),rank(2,"Movie",2),rank(3,"Movie",3)]);
  expect(out.map(x=>x.id)).toEqual([id(21),id(3)]);
 });
 it("returns no fake trends if the public ranks do not match a scoped page",()=>{
  expect(matchTrending([film(5)],[rank(6),rank(7)])).toEqual([]);
  expect(matchTrending([],[])).toEqual([]);
 });
 it("enforces a bounded requested count and preserves stable order",()=>{
  const rows=Array.from({length:70},(_,i)=>film(i+1));
  const ranks=rows.map((x,i)=>rank(i+1,"Movie",i+1));
  expect(matchTrending(rows,ranks,16).map(x=>x.id))
    .toEqual(rows.slice(0,16).map(x=>x.id));
  expect(()=>matchTrending(rows,ranks,1000)).toThrow("TRENDING_LIMIT_INVALID");
 });
});
