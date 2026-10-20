import {describe,it,expect} from "vitest";
import {UNIVERSES,belongsToUniverse,universeItems} from "../src/universes";
import type {MediaItem} from "../src/types";
const id=(n:number)=>n.toString(16).padStart(32,"0");
const row=(n:number,patch:Partial<MediaItem>={}):MediaItem=>({
  id:id(n),title:"Film "+n,type:"Movie",year:2025,
  genres:["Action"],tags:[],studios:[],communityRating:8,
  overview:"",isFavorite:false,played:false,progress:null,
  premiereDate:"2025-01-01",hasPrimary:true,hasBackdrop:true,
  seriesName:"",...patch
});
describe("Jellyfin universes parity",()=>{
 it("reuses the six approved universe logos and order",()=>{
   expect(UNIVERSES.map(x=>x.id))
     .toEqual(["mcu","disney","pixar","dreamworks","starwars","dc"]);
   expect(UNIVERSES.every(x=>x.logo.startsWith("/universes/"))).toBe(true);
 });
 it("identifies cinematic brands from specific metadata, not title similarity",()=>{
   expect(belongsToUniverse(row(1,{studios:["Marvel Studios"],
     year:2024}),"mcu")).toBe(true);
   expect(belongsToUniverse(row(2,{title:"Marvel Studios: Legends",
     tags:["Marvel Cinematic Universe (MCU)"]}),"mcu")).toBe(false);
   expect(belongsToUniverse(row(3,{studios:["Marvel Studios"],
     year:2005}),"mcu")).toBe(false);
   expect(belongsToUniverse(row(4,{studios:["Lucasfilm Ltd."]}),
     "starwars")).toBe(true);
   expect(belongsToUniverse(row(5,{tags:["Star Wars"]}),
     "starwars")).toBe(true);
   expect(belongsToUniverse(row(6,{tags:["DC extended universe"]}),
     "dc")).toBe(true);
   expect(belongsToUniverse(row(7,{studios:["Pixar Animation Studios"]}),
     "pixar")).toBe(true);
   expect(belongsToUniverse(row(8,{tags:["Science Fiction"]}),
     "starwars")).toBe(false);
 });
 it("groups authorized local items uniquely in chronological order",()=>{
   const data=[row(2,{studios:["Pixar Animation Studios"],year:2026}),
     row(1,{studios:["Pixar"],year:2019}),
     row(1,{studios:["Pixar"],year:2019}),
     row(3,{studios:["DreamWorks Animation"],year:2022})];
   expect(universeItems("pixar",data).map(x=>x.id)).toEqual([id(1),id(2)]);
 });
});
