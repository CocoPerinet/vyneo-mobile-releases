import type {MediaItem,Shelf} from "./types";
import type {SessionStamp,NativeG7yTransport} from "./g7z-secure-shelves";

const GUID=/^[a-f0-9]{32}$/i;
const PREFIX:Record<string,string>={
  genre:"Selon vos genres : ",
  favorite:"Genre de vos favoris : ",
  collection:"Collection déjà regardée · ",
  studio:"Studio déjà regardé · ",
  editorial:"Thème classé par IA locale · "
};
const CARD=["id","type","title","year","caption",
 "progressPercent","reasonGenre","reasonKind"];
const ROOT=["schema","items","count","userEntitlementVerified",
 "realPlaybackAuthorized","playableUrls","mediaBytesRead"];
const exact=(o:unknown,keys:string[]):o is Record<string,unknown>=>
  !!o && typeof o==="object" && !Array.isArray(o) &&
  Object.keys(o).length===keys.length &&
  keys.every(key=>Object.prototype.hasOwnProperty.call(o,key));
const safe=(v:unknown,max:number):v is string=>
  typeof v==="string" && v.length<=max && v.trim().length>0 &&
  !/[<>\u0000-\u001f\u007f-\u009f\\]/.test(v);
export function validateNativePersonal(
  raw:unknown,allowed:readonly MediaItem[],now=new Date()
):Shelf|null{
  if(!exact(raw,ROOT) || raw.schema!=="vyneo.g7w.private_personal_affinity.v1"
     || raw.userEntitlementVerified!==false ||
     raw.realPlaybackAuthorized!==false || raw.playableUrls!==0 ||
     raw.mediaBytesRead!==0 || !Array.isArray(raw.items) ||
     raw.items.length>8 || raw.count!==raw.items.length ||
     !Number.isFinite(now.getTime()))throw Error("G7Z_PERSONAL_DENIED");
  const index=new Map<string,MediaItem>();
  for(const item of allowed.slice(0,640)){
    if(!GUID.test(item.id) || index.has(item.id.toLowerCase()))
      throw Error("G7Z_PERSONAL_SCOPE_DENIED");
    index.set(item.id.toLowerCase(),item);
  }
  const found:MediaItem[]=[],reasons:Record<string,string>={};
  const seen=new Set<string>();
  for(const row of raw.items){
    if(!exact(row,CARD) || !safe(row.id,32) || !GUID.test(row.id)
       || seen.has(row.id.toLowerCase())
       || !["Movie","Series"].includes(String(row.type))
       || !safe(row.title,160) ||
       (row.year!==null && (!Number.isSafeInteger(row.year)
         || (row.year as number)<1900 || (row.year as number)>2100))
       || row.progressPercent!==null ||
       !safe(row.reasonGenre,45) ||
       typeof row.reasonKind!=="string" ||
       !(row.reasonKind in PREFIX) ||
       row.caption!==PREFIX[row.reasonKind]+row.reasonGenre)
      throw Error("G7Z_PERSONAL_DENIED");
    const own=index.get(row.id.toLowerCase());
    if(!own || own.type!==row.type || own.played ||
       (own.progress!==null && own.progress>0) ||
       (own.year!==null && own.year>now.getUTCFullYear()) ||
       own.premiereDate.slice(0,10)>now.toISOString().slice(0,10) ||
       !own.genres.some(g=>g.trim().toLocaleLowerCase("fr")
         ===(row.reasonGenre as string).trim().toLocaleLowerCase("fr")))
      throw Error("G7Z_PERSONAL_SCOPE_DENIED");
    seen.add(row.id.toLowerCase());
    found.push(own);
    reasons[own.id]=row.caption as string;
  }
  return found.length?{id:"g7w-for-you",
    title:"Pour vous · Sélection intelligente",items:found,reasons}:null;
}
export interface NativePersonalSource{
  current:()=>SessionStamp|null;
  allowed:()=>readonly MediaItem[];
  nativeTransport:NativeG7yTransport;
  now?:()=>Date;
}
export async function requestNativePersonal(
  source:NativePersonalSource
):Promise<Shelf|null>{
  const scope=source.current();
  if(!scope || !GUID.test(scope.userId) ||
     !Number.isSafeInteger(scope.epoch) || scope.epoch<0)return null;
  const allowed=source.allowed().slice(0,640);
  if(!allowed.length)return null;
  try{
    const response=await source.nativeTransport(scope.userId);
    const after=source.current();
    if(!after || after.userId.toLowerCase()!==scope.userId.toLowerCase()
        || after.epoch!==scope.epoch)return null;
    return validateNativePersonal(response,allowed,source.now?.()??new Date());
  }catch{return null;}
}
export function mergeNativePersonal(
  local:readonly Shelf[],native:Shelf|null
):Shelf[]{
  if(!native || native.items.length<2)return [...local];
  const reserved=new Set(local.filter(row=>
    row.id==="resume" || row.id==="next-up" || row.id==="favorites")
    .flatMap(row=>row.items.map(item=>item.id.toLowerCase())));
  const items=native.items.filter(item=>!reserved.has(item.id.toLowerCase()));
  if(items.length<2)return [...local];
  return local.map(row=>{
    if(row.id!=="for-you")return row;
    const seen=new Set(items.map(item=>item.id.toLowerCase()));
    const fallback=row.items.filter(item=>!seen.has(item.id.toLowerCase())
      && !reserved.has(item.id.toLowerCase())).slice(0,Math.max(0,18-items.length));
    const reasons={...row.reasons,...native.reasons};
    return {...row,title:native.title,
      items:[...items,...fallback].slice(0,18),reasons};
  });
}

