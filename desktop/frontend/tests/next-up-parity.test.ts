import {describe,it,expect} from "vitest";
import {buildShelves} from "../src/discover";
import type {MediaItem,LibrarySnapshot} from "../src/types";
const id=(n:number)=>n.toString(16).padStart(32,"0");
const row=(n:number):MediaItem=>({
 id:id(n+10000),type:"Episode",title:"Episode "+n,seriesName:"Series "+n,
 year:2026,overview:"",genres:["Action"],communityRating:7,
 isFavorite:false,played:false,progress:null,premiereDate:"2026-09-20",
 hasPrimary:true,hasBackdrop:true,seasonNumber:3,episodeNumber:2
});
describe("NextUp must not silently discard user series",()=>{
 it("keeps 270 unique episodes, not 22 or 30",()=>{
   const nextUp=Array.from({length:270},(_,i)=>row(i));
   const data:LibrarySnapshot={
     recent:[],resume:[],nextUp,favorites:[],
     watched:[],collections:[]
   };
   const shelf=buildShelves(data,"a".repeat(32)).find(x=>x.id==="next-up");
   expect(shelf?.items.length).toBe(270);
   expect(shelf?.items.at(-1)?.id).toBe(id(10269));
 });
 it("does not duplicate repeated IDs",()=>{
   const data:LibrarySnapshot={
    recent:[],resume:[],nextUp:[row(1),row(1),row(2)],
    favorites:[],watched:[],collections:[]
   };
   expect(buildShelves(data,"a".repeat(32)).find(x=>x.id==="next-up")
     ?.items.length).toBe(2);
 });
});

