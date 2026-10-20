// Match G7y's exact week and SHA256 page selection before using a second,
// independent Jellyfin user-token read to confirm every rendered title.
const GUID=/^[a-f0-9]{32}$/i;
export const G7Y_BATCH=128;

function isoWeekInParis(now:Date):string{
  const fields=Intl.DateTimeFormat("en-US",{
    timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(now);
  const value=(name:string)=>Number(fields.find(f=>f.type===name)?.value);
  const date=new Date(Date.UTC(
    value("year"),value("month")-1,value("day")
  ));
  date.setUTCDate(date.getUTCDate()+4-(date.getUTCDay()||7));
  const year=date.getUTCFullYear();
  const start=new Date(Date.UTC(year,0,1));
  const week=Math.ceil(((date.getTime()-start.getTime())/86400000+1)/7);
  return year+"-W"+String(week).padStart(2,"0");
}
async function hashIndex(seed:string,period:string,key:string,
  size:number):Promise<number>{
  if(!Number.isSafeInteger(size) || size<1)throw Error("G7Y_PAGES_INVALID");
  const bytes=new TextEncoder().encode(
    seed+"|"+period+"|window|"+key);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  const first=new Uint8Array(digest,0,8);
  let number=0n;
  for(const byte of first)number=number*256n+BigInt(byte);
  return Number(number%BigInt(size));
}
export async function g7yVerifiedPages(
  userId:string,total:number,now=new Date()
):Promise<number[]>{
  if(!GUID.test(userId) || !Number.isSafeInteger(total) ||
     total<0 || total>1_000_000 || !Number.isFinite(now.getTime()))
    throw Error("G7Y_PAGES_INVALID");
  const pages=Math.min(128,Math.ceil(total/G7Y_BATCH));
  if(pages<=1)return [0];
  if(pages<=4)return Array.from({length:pages},(_,i)=>i);
  const remain=Array.from({length:pages-2},(_,i)=>i+2);
  const midpoint=Math.max(1,Math.floor(remain.length/2));
  const lower=remain.slice(0,midpoint);
  const upper=remain.slice(midpoint);
  const period=isoWeekInParis(now);
  const middle=lower[await hashIndex(
    userId.toLowerCase(),period,"older-middle",lower.length)];
  const older=upper[await hashIndex(
    userId.toLowerCase(),period,"older-archive",upper.length)];
  if(middle===undefined || older===undefined ||
     middle===older || middle<2 || older<2)
    throw Error("G7Y_PAGES_INVALID");
  return [0,1,middle,older];
}

