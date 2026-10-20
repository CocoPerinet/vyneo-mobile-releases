import type {MediaItem,Shelf} from "./types";
import {validateG7yRows} from "./g7y-contract";

// This is a pure adapter. The native transport must perform OAuth/PKCE,
// verify Access subject+Jellyfin account server-side, and keep ALL secrets
// in the OS vault. It must NEVER be an ordinary frontend fetch() call.
export type SessionStamp={userId:string;epoch:number};
export type NativeG7yTransport=(accountId:string)=>Promise<unknown>;
export interface NativeG7ySource{
  current:()=>SessionStamp|null;
  allowed:()=>readonly MediaItem[];
  nativeTransport:NativeG7yTransport;
  now?:()=>Date;
}
const GUID=/^[a-f0-9]{32}$/i;

function validStamp(x:SessionStamp|null):x is SessionStamp{
  return x!==null && GUID.test(x.userId) &&
    Number.isSafeInteger(x.epoch) && x.epoch>=0;
}
function same(left:SessionStamp,right:SessionStamp|null):boolean{
  return validStamp(right) && left.epoch===right.epoch &&
    left.userId.toLowerCase()===right.userId.toLowerCase();
}

// A denial or malformed response *never* replaces local recommendations,
// revokes a Jellyfin account or exposes user-private identifiers.
export async function requestNativeG7y(
  source:NativeG7ySource
):Promise<Shelf[]|null>{
  const stamp=source.current();
  if(!validStamp(stamp))return null;
  const allowed=source.allowed().slice(0,640);
  if(!allowed.length)return null;
  try{
    const raw=await source.nativeTransport(stamp.userId);
    if(!same(stamp,source.current()))return null;
    const rows=validateG7yRows(raw,allowed,source.now?.()??new Date());
    if(!same(stamp,source.current()))return null;
    return rows;
  }catch{
    return null;
  }
}

// Existing "Resume", "Next Up", own recommendations and favorites are
// authoritative. Server suggestions may only fill nonduplicate slots.
export function mergeNativeG7y(local:readonly Shelf[],
  remote:readonly Shelf[]|null):Shelf[]{
  if(!remote?.length)return [...local];
  const existingIds=new Set(local.flatMap(row=>row.items.map(item=>
    item.id.toLowerCase())));
  const merged=[...local];
  for(const row of remote.slice(0,11)){
    if(!row.id.startsWith("g7y-"))continue;
    const items=row.items.filter(item=>{
      const id=item.id.toLowerCase();
      if(existingIds.has(id))return false;
      existingIds.add(id);return true;
    });
    if(items.length<2)continue;
    const top=row.id==="g7y-top";
    const title=top?(items.length===10?"Top 10 des découvertes pour vous":
      "Découvertes sélectionnées"):row.title;
    merged.push({...row,title,kind:top && items.length===10?"top10":"standard",
      items:items.slice(0,top?10:5)});
  }
  return merged;
}

