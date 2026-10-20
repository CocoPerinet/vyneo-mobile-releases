// Bounded, private metadata discovery inspired by G7y's sampling strategy.
// No user identity, history or recommendation output is persisted.
const USER_ID=/^[a-f0-9]{32}$/i;
const BATCH=128;
export const CANDIDATE_BATCH_SIZE=BATCH;
function isoWeek(date:Date):string{
  const day=new Date(Date.UTC(date.getUTCFullYear(),
    date.getUTCMonth(),date.getUTCDate()));
  day.setUTCDate(day.getUTCDate()+4-(day.getUTCDay()||7));
  const year=day.getUTCFullYear();
  const first=new Date(Date.UTC(year,0,1));
  const week=Math.ceil(((day.getTime()-first.getTime())/86400000+1)/7);
  return year+"-W"+String(week).padStart(2,"0");
}
function stableSeed(value:string):number{
  let valueHash=2166136261;
  for(const char of value)
    valueHash=Math.imul(valueHash^char.charCodeAt(0),16777619);
  return valueHash>>>0;
}
export function candidateOffsets(userId:string,total:number,
  now=new Date()):number[]{
  if(!USER_ID.test(userId) || !Number.isSafeInteger(total) ||
     total<0 || total>1_000_000_000 || !Number.isFinite(now.getTime()))
    throw new Error("CANDIDATE_SCOPE_INVALID");
  const pages=Math.min(128,Math.ceil(total/BATCH));
  if(pages<=1)return [];
  const offsets=[BATCH];
  if(pages>2){
    const midLast=Math.max(2,Math.floor((pages-1)/2));
    const seed=stableSeed(userId.toLowerCase()+":"+isoWeek(now));
    const mid=2+seed%(midLast-1);
    offsets.push(mid*BATCH);
    const oldFirst=midLast+1;
    if(oldFirst<pages){
      const older=oldFirst+stableSeed(seed+":old")%(pages-oldFirst);
      offsets.push(older*BATCH);
    }
  }
  return offsets;
}
