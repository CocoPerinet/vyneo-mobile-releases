import {describe,it,expect} from "vitest";
import {UNIVERSES,belongsToUniverse,universeItems,
  groupUniverseItems} from "../src/universes";
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
 it("matches the seven Jellyfin theme universes and preserves their order",()=>{
   expect(UNIVERSES.map(x=>x.id))
     .toEqual(["mcu","disney","pixar","dreamworks","starwars","dc","dcu"]);
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
   expect(belongsToUniverse(row(9,{studios:["DC Studios"],year:2025}),
     "dcu")).toBe(true);
   expect(belongsToUniverse(row(9,{studios:["DC Studios"],year:2025}),
     "dc")).toBe(false);
   expect(belongsToUniverse(row(9,{studios:["DC Studios"],year:2024}),
     "dcu")).toBe(false);
   expect(belongsToUniverse(row(10,{title:"Joker",studios:["Warner Bros."]}),
     "dc")).toBe(true);
   expect(belongsToUniverse(row(11,{title:"Andor",type:"Series",
     studios:["Disney+"]}),"starwars")).toBe(true);
   expect(belongsToUniverse(row(12,{title:"Indiana Jones et le cadran de la destinée",
     studios:["Lucasfilm Ltd."]}),"starwars")).toBe(false);

 });
 it("uses the exact MCU phase boundary between April and July 2025",()=>{
   const spring=row(20,{tags:["MCU"],year:2025,
     premiereDate:"2025-04-30",title:"Thunderbolts*"});
   const summer=row(21,{tags:["MCU"],year:2025,
     premiereDate:"2025-07-23",title:"Les 4 Fantastiques"});
   const origin=row(22,{tags:["MCU"],year:2008,
     premiereDate:"2008-05-01",title:"Iron Man"});
   const groups=groupUniverseItems("mcu",[summer,origin,spring]);
   expect(groups.map(x=>x.name)).toEqual(["Phase 1","Phase 5","Phase 6"]);
   expect(groups.map(x=>x.items[0].id))
     .toEqual([origin.id,spring.id,summer.id]);
 });
 it("sorts Star Wars by fictional chronology, not theatrical premiere",()=>{
   const acolyte=row(30,{title:"Star Wars : The Acolyte",type:"Series",
     year:2024,studios:["Disney+"]});
   const rogue=row(31,{title:"Rogue One",studios:["Lucasfilm"],
     premiereDate:"2016-12-16",year:2016});
   const andor=row(32,{title:"Andor",type:"Series",studios:["Disney+"],
     premiereDate:"2022-09-01",year:2022});
   const ahsoka=row(33,{title:"Ahsoka",type:"Series",studios:["Disney+"]});
   const misc=row(34,{title:"Une archive Star Wars",
     tags:["Star Wars"]});
   const groups=groupUniverseItems("starwars",
     [rogue,ahsoka,andor,misc,acolyte]);
   expect(groups.map(x=>x.name)).toEqual([
     "La Haute République","Trilogie originale",
     "Trilogie de la suite","Autres aventures Star Wars"
   ]);
   expect(groups[1].items.map(x=>x.id)).toEqual([andor.id,rogue.id]);
   expect(groups[3].items.map(x=>x.id)).toEqual([misc.id]);
 });
 it("shows decades and preserves undated authorized titles",()=>{
   const old=row(41,{year:2009,premiereDate:"2009-04-01",
     studios:["Pixar Animation Studios"]});
   const latest=row(42,{year:2026,premiereDate:"2026-07-01",
     studios:["Pixar Animation Studios"]});
   const undated=row(43,{year:null,premiereDate:"",
     studios:["Pixar Animation Studios"]});
   const groups=groupUniverseItems("pixar",[latest,undated,old,old]);
   expect(groups.map(x=>x.name)).toEqual([
     "Années 2000","Années 2020","Date inconnue"
   ]);
   expect(groups.flatMap(x=>x.items.map(i=>i.id)))
     .toEqual([old.id,latest.id,undated.id]);
 });
 it("keeps DC Studios inside the sole validated DCU chapter",()=>{
   const dcu=row(50,{studios:["DC Studios"],year:2025,
     premiereDate:"2025-07-01"});
   expect(groupUniverseItems("dcu",[dcu])).toEqual([{
     name:"Chapitre 1 : Gods and Monsters",items:[dcu]
   }]);
   expect(groupUniverseItems("dc",[dcu])).toEqual([]);
 });
 it("groups authorized local items uniquely in chronological order",()=>{
   const data=[row(2,{studios:["Pixar Animation Studios"],year:2026}),
     row(1,{studios:["Pixar"],year:2019}),
     row(1,{studios:["Pixar"],year:2019}),
     row(3,{studios:["DreamWorks Animation"],year:2022})];
   expect(universeItems("pixar",data).map(x=>x.id)).toEqual([id(1),id(2)]);
 });
});
