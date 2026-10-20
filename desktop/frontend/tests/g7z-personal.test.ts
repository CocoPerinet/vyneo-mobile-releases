import {describe,it,expect} from "vitest";
import {validateNativePersonal,requestNativePersonal,mergeNativePersonal}
  from "../src/g7z-personal";
import type {MediaItem,Shelf} from "../src/types";

const id=(n:number)=>n.toString(16).padStart(32,"0");
const uid=id(900);
const now=new Date("2026-10-20T10:00:00Z");
const own=(n:number,patch:Partial<MediaItem>={}):MediaItem=>({
 id:id(n),title:"Own title "+n,type:"Movie",year:2025,
 overview:"",genres:["Action"],communityRating:8,isFavorite:false,
 played:false,progress:null,premiereDate:"2025-02-01",
 hasPrimary:true,hasBackdrop:true,seriesName:"",...patch
});
const reason=(n:number,kind="genre")=>({
 id:id(n),type:"Movie",title:"External "+n,year:2025,
 caption:kind==="genre"?"Selon vos genres : Action":
   "Genre de vos favoris : Action",
 reasonGenre:"Action",reasonKind:kind,progressPercent:null
});
const payload=()=>({
 schema:"vyneo.g7w.private_personal_affinity.v1",
 items:[reason(1),reason(2,"favorite")],count:2,
 userEntitlementVerified:false,realPlaybackAuthorized:false,
 playableUrls:0,mediaBytesRead:0
});
describe("G7z personal recommendations use only signed, locally confirmed items",()=>{
 it("retains own titles, validates reasons, never imports external metadata",()=>{
   const personal=validateNativePersonal(payload(),[own(1),own(2)],now);
   expect(personal?.items.map(x=>x.title)).toEqual(["Own title 1","Own title 2"]);
   expect(personal?.reasons?.[id(2)]).toBe("Genre de vos favoris : Action");
   expect(JSON.stringify(personal)).not.toContain("External 1");
 });
 it("denies fake rights, unknown IDs and injected paths",()=>{
   for(const candidate of [
     {...payload(),userEntitlementVerified:true},
     {...payload(),playableUrls:1},
     {...payload(),mediaBytesRead:12000},
     {...payload(),extra:"/etc/passwd"},
     {...payload(),items:[reason(1),reason(99)]},
     {...payload(),items:[{...reason(1),mediaPath:"/secret"},reason(2)]}
   ]){
     expect(()=>validateNativePersonal(candidate,[own(1),own(2)],now)).toThrow();
   }
 });
 it("refuses candidates viewed, in progress, future or wrong genre",()=>{
   for(const patch of [
     {played:true},{progress:50},{year:2028},
     {premiereDate:"2026-12-01"},{genres:["Comédie"]},
     {type:"Series" as const}
   ]){
     expect(()=>validateNativePersonal(payload(),
       [own(1,patch),own(2)],now)).toThrow("G7Z_PERSONAL_SCOPE_DENIED");
   }
 });
 it("drops responses that cross identity or session epoch",async()=>{
   let current:{userId:string;epoch:number}|null={userId:uid,epoch:1};
   let release!:(x:unknown)=>void;
   const task=requestNativePersonal({
     current:()=>current,allowed:()=>[own(1),own(2)],
     nativeTransport:()=>new Promise(resolve=>{release=resolve;}),
     now:()=>now
   });
   current={userId:uid,epoch:2};
   release(payload());
   expect(await task).toBeNull();
 });
 it("falls back to local without revoking when network is unavailable",async()=>{
   const received=await requestNativePersonal({
     current:()=>({userId:uid,epoch:1}),
     allowed:()=>[own(1),own(2)],
     nativeTransport:async()=>{throw Error("offline");},now:()=>now
   });
   expect(received).toBeNull();
 });
 it("puts personalized evidence ahead of local without duplicate Resume",()=>{
   const local:Shelf[]=[
     {id:"resume",title:"Reprendre",items:[own(1)]},
     {id:"for-you",title:"Pour vous",items:[own(3),own(4)]},
     {id:"favorites",title:"Ma liste",items:[own(5)]}
   ];
   const personal=validateNativePersonal(payload(),[own(1),own(2)],now);
   const merged=mergeNativePersonal(local,personal);
   expect(merged[0]).toEqual(local[0]);
   expect(merged[1].items.map(x=>x.id)).toEqual([id(3),id(4)]);
   const revised=validateNativePersonal(
      {...payload(),items:[reason(2),reason(6)]},[own(2),own(6)],now);
   const merged2=mergeNativePersonal(local,revised);
   expect(merged2[1].items.map(x=>x.id).slice(0,2)).toEqual([id(2),id(6)]);
   expect(merged2[1].reasons?.[id(6)]).toContain("Action");
 });
});

