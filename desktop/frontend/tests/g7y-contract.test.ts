import {describe,it,expect} from "vitest";
import {validateG7yRows} from "../src/g7y-contract";
import type {MediaItem} from "../src/types";

const ID=(n:number)=>n.toString(16).padStart(32,"0");
const now=new Date("2026-10-20T10:00:00Z");
const item=(n:number,patch:Partial<MediaItem>={}):MediaItem=>({
  id:ID(n),title:"Titre Jellyfin "+n,type:"Movie",year:2023,
  overview:"Vérifié par Jellyfin",genres:["Action"],communityRating:8,
  isFavorite:false,played:false,progress:null,premiereDate:"2023-01-01",
  hasPrimary:true,hasBackdrop:true,seriesName:"",...patch
});
function card(n:number,rank:number|null=null){
  return {
    id:ID(n),type:"Movie",title:"Titre BFF "+n,year:2023,
    caption:rank===null?"À découvrir dans votre bibliothèque":
      "Sélection de votre catalogue",
    progressPercent:null,...(rank===null?{}:{rank})
  };
}
function payload(){
  return {
    schema:"vyneo.g7x.private_rotating_shelves.v1",
    top:[card(1,1),card(2,2),card(3,3)],
    topTitle:"Top 3 à découvrir",topCount:3,
    sections:[{
      key:"rotation-scifi",title:"Aventures spatiales",
      items:[card(4),card(5)]
    }],
    count:1,rotationDate:"2026-10-20",nextRotationDate:"2026-10-21",
    availableRecipes:46,
    rankingBasis:"catalogue_and_personal_affinity_not_views",
    userEntitlementVerified:false,realPlaybackAuthorized:false,
    playableUrls:0,mediaBytesRead:0
  };
}
const allowed=()=>Array.from({length:5},(_,i)=>item(i+1));
describe("G7y native import is fail-closed, not a login bypass",()=>{
  it("renders only own Jellyfin metadata, never BFF-provided titles",()=>{
    const rows=validateG7yRows(payload(),allowed(),now);
    expect(rows.map(row=>row.title))
      .toEqual(["Top 3 à découvrir","Aventures spatiales"]);
    expect(rows.map(row=>row.items.length)).toEqual([3,2]);
    expect(rows[0].kind).toBe("top10");
    expect(rows[0].items[0]).toEqual(allowed()[0]);
    expect(rows[0].items[0].title).toBe("Titre Jellyfin 1");
    expect(rows.flatMap(row=>row.items).map(item=>item.title))
      .not.toContain("Titre BFF 1");
  });
  it("rejects foreign items even if their names and flags look valid",()=>{
    const response=payload();
    response.sections[0].items[0]=card(99);
    expect(()=>validateG7yRows(response,allowed(),now))
      .toThrow("G7Y_SCOPE_DENIED");
  });
  it("refuses duplicate items across top and sections",()=>{
    const response=payload();
    response.sections[0].items[1]=card(1);
    expect(()=>validateG7yRows(response,allowed(),now))
      .toThrow("G7Y_CONTRACT_DENIED");
  });
  it("rejects extra response properties including paths and secrets",()=>{
    const response={...payload(),transcodingUrl:"https://private.example?api_key=SECRET"};
    expect(()=>validateG7yRows(response,allowed(),now))
      .toThrow("G7Y_CONTRACT_DENIED");
    const response2=payload();
    response2.top[0]={...response2.top[0],path:"/mnt/hidden"} as typeof response2.top[0];
    expect(()=>validateG7yRows(response2,allowed(),now))
      .toThrow("G7Y_CONTRACT_DENIED");
  });
  it("rejects forged authorization and streaming claims",()=>{
    for(const mutated of [
      {userEntitlementVerified:true},{realPlaybackAuthorized:true},
      {playableUrls:1},{mediaBytesRead:2048},
      {rankingBasis:"views_counter"},{topCount:4},
      {schema:"vyneo.bad.v1"},{nextRotationDate:"2026-10-22"}
    ]){
      expect(()=>validateG7yRows({...payload(),...mutated},allowed(),now))
        .toThrow("G7Y_CONTRACT_DENIED");
    }
  });
  it("rejects XSS, wrong type, mismatched title rank and unsafe sections",()=>{
    for(const mutate of [
      (x:ReturnType<typeof payload>)=>{x.top[0].title="<img src=x>";},
      (x:ReturnType<typeof payload>)=>{x.top[0].rank=3;},
      (x:ReturnType<typeof payload>)=>{x.sections[0].title="<script>";},
      (x:ReturnType<typeof payload>)=>{x.sections[0].key="https://attacker";},
      (x:ReturnType<typeof payload>)=>{x.top[1].type="Series";}
    ]){
      const response=payload();mutate(response);
      expect(()=>validateG7yRows(response,allowed(),now))
        .toThrow(/G7Y_(?:CONTRACT|SCOPE)_DENIED/);
    }
  });
  it("cannot promote played, in-progress or future Jellyfin titles",()=>{
    for(const change of [
      {played:true},{progress:15},{year:2027},
      {premiereDate:"2026-12-01"},{type:"Series" as const}
    ]){
      const local=allowed();local[0]={...local[0],...change};
      expect(()=>validateG7yRows(payload(),local,now))
        .toThrow("G7Y_SCOPE_DENIED");
    }
  });
  it("refuses duplicate local references and missing account scope",()=>{
    expect(()=>validateG7yRows(payload(),[],now))
      .toThrow("G7Y_SCOPE_DENIED");
    const local=allowed();local[1]={...local[0]};
    expect(()=>validateG7yRows(payload(),local,now))
      .toThrow("G7Y_SCOPE_DENIED");
  });
});
