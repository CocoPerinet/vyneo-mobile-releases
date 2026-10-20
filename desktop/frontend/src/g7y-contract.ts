import type {MediaItem,Shelf} from "./types";

// Sanitizer for a FUTURE authenticated native G7y transport.
// It does not perform authentication, fetch data or enable any network
// endpoint. Its catalogue must come from this session's Jellyfin API.
const GUID=/^[a-f0-9]{32}$/i;
const safe=(x:unknown):x is Record<string,unknown>=>
  !!x && typeof x==="object" && !Array.isArray(x);
function strict(x:unknown,keys:string[]):x is Record<string,unknown>{
  return safe(x) && Object.keys(x).length===keys.length &&
    keys.every(key=>Object.prototype.hasOwnProperty.call(x,key));
}
function clean(value:unknown,max:number):value is string{
  return typeof value==="string" && value.trim().length>0 &&
    value.length<=max && !/[<>\\\u0000-\u001f\u007f-\u009f]/.test(value);
}
const META=["id","type","title","year","caption","progressPercent"];
const TOP=[...META,"rank"];
const RESPONSE=["schema","top","topTitle","topCount","sections","count",
  "rotationDate","nextRotationDate","availableRecipes","rankingBasis",
  "userEntitlementVerified","realPlaybackAuthorized",
  "playableUrls","mediaBytesRead"];
const SECTION=["key","title","items"];
export function validateG7yRows(
  raw:unknown,visible:readonly MediaItem[],now=new Date()
):Shelf[]{
  if(!strict(raw,RESPONSE) ||
     raw.schema!=="vyneo.g7x.private_rotating_shelves.v1" ||
     raw.rankingBasis!=="catalogue_and_personal_affinity_not_views" ||
     raw.userEntitlementVerified!==false ||
     raw.realPlaybackAuthorized!==false ||
     raw.playableUrls!==0 || raw.mediaBytesRead!==0 ||
     !Array.isArray(raw.top) || raw.top.length>10 ||
     !Array.isArray(raw.sections) || raw.sections.length>10 ||
     raw.topCount!==raw.top.length || raw.count!==raw.sections.length ||
     typeof raw.availableRecipes!=="number" ||
     !Number.isSafeInteger(raw.availableRecipes) ||
     raw.availableRecipes<46 || raw.availableRecipes>80 ||
     !Number.isFinite(now.getTime()) ||
     typeof raw.rotationDate!=="string" ||
     !/^\d{4}-\d{2}-\d{2}$/.test(raw.rotationDate) ||
     !Number.isFinite(Date.parse(raw.rotationDate)) ||
     raw.nextRotationDate!==new Date(
       Date.parse(raw.rotationDate)+86400000).toISOString().slice(0,10))
    throw new Error("G7Y_CONTRACT_DENIED");
  const topTitle=raw.top.length===10
    ?"Top 10 des découvertes pour vous"
    :raw.top.length>=3
      ?"Top "+raw.top.length+" à découvrir"
      :"Découvertes sélectionnées";
  if(raw.topTitle!==topTitle)throw new Error("G7Y_CONTRACT_DENIED");
  const locallyVisible=new Map<string,MediaItem>();
  for(const item of visible.slice(0,640)){
    if(!GUID.test(item.id) || locallyVisible.has(item.id.toLowerCase()))
      throw new Error("G7Y_SCOPE_DENIED");
    locallyVisible.set(item.id.toLowerCase(),item);
  }
  const seen=new Set<string>();
  const mapItem=(source:unknown,rank:number|null):MediaItem=>{
    if(!strict(source,rank===null?META:TOP) ||
       typeof source.id!=="string" || !GUID.test(source.id) ||
       seen.has(source.id.toLowerCase()) ||
       (source.type!=="Movie" && source.type!=="Series") ||
       !clean(source.title,160) ||
       (source.year!==null && (
         typeof source.year!=="number" || !Number.isSafeInteger(source.year) ||
         source.year<1900 || source.year>2100)) ||
       source.progressPercent!==null ||
       source.caption!==(rank===null
         ?"À découvrir dans votre bibliothèque":"Sélection de votre catalogue") ||
       (rank!==null && source.rank!==rank))
      throw new Error("G7Y_CONTRACT_DENIED");
    const item=locallyVisible.get(source.id.toLowerCase());
    // The BFF cannot introduce previously invisible titles into the app.
    // Only the client's own account-authorized Jellyfin metadata is shown.
    if(!item || item.type!==source.type || item.played ||
       (item.progress!==null && item.progress>0) ||
       (item.year!==null && item.year>now.getUTCFullYear()) ||
       item.premiereDate.slice(0,10)>now.toISOString().slice(0,10))
      throw new Error("G7Y_SCOPE_DENIED");
    seen.add(source.id.toLowerCase());
    return item;
  };
  const rows:Shelf[]=[];
  const top=raw.top.map((card,i)=>mapItem(card,i+1));
  if(top.length)rows.push({
    id:"g7y-top",title:topTitle,items:top,kind:"top10"
  });
  const keys=new Set<string>();
  for(const section of raw.sections){
    if(!strict(section,SECTION) ||
       !clean(section.key,82) ||
       !/^rotation-[a-z0-9-]{2,72}$/.test(section.key) ||
       keys.has(section.key) ||
       !clean(section.title,96) ||
       !Array.isArray(section.items) ||
       section.items.length<2 || section.items.length>5)
      throw new Error("G7Y_CONTRACT_DENIED");
    keys.add(section.key);
    const items=section.items.map(card=>mapItem(card,null));
    rows.push({id:"g7y-"+section.key,title:section.title,items});
  }
  return rows;
}
