import {describe,it,expect,vi} from "vitest";
import {candidateOffsets,CANDIDATE_BATCH_SIZE} from "../src/candidate-pages";
import {JellyfinApi,SERVER_ORIGIN} from "../src/api";

const ID=(n:number)=>n.toString(16).padStart(32,"0");
const USER=ID(900001),TOKEN="t".repeat(48);
const date=new Date("2026-10-20T08:00:00Z");
const json=(obj:unknown,status=200)=>new Response(JSON.stringify(obj),{
  status,headers:{"Content-Type":"application/json"}
});
const media=(n:number)=>({
  Id:ID(n+1),Name:"Film "+n,Type:n%2?"Movie":"Series",
  Genres:["Action"],UserData:{Played:false},ProductionYear:2022
});
function fixture(total:number,opts:{
  noTotal?:boolean;
  errorPage?:number;
  duplicatePage?:number;
  delayedPage?:number;
}={}){
  const calls:Array<{url:URL;options:RequestInit}>=[];
  let unblock:((value:Response)=>void)|null=null;
  const fetcher=vi.fn(async(input:RequestInfo|URL,options:RequestInit={})=>{
    const url=new URL(String(input));calls.push({url,options});
    if(url.pathname==="/Users/AuthenticateByName")
      return json({User:{Id:USER},AccessToken:TOKEN});
    if(url.pathname==="/Users/Me")return json({Id:USER,Name:"Alice"});
    if(url.pathname==="/Users/"+USER+"/Items"){
      const offset=Number(url.searchParams.get("StartIndex")??"0");
      if(offset===opts.delayedPage)
        return new Promise<Response>(resolve=>{unblock=resolve;});
      if(offset===opts.errorPage)return json({error:"unavailable"},503);
      const items=Array.from(
        {length:Math.min(128,Math.max(0,total-offset))},
        (_,i)=>media(offset+i)
      );
      if(opts.duplicatePage===offset && items.length)
        items[0]=media(0);
      return json({
        Items:items,...(!opts.noTotal?{TotalRecordCount:total}:{})
      });
    }
    throw new Error("unexpected route");
  }) as typeof fetch;
  return {
    api:new JellyfinApi({fetcher}),calls,
    resolve:()=>unblock?.(json({
      Items:Array.from({length:128},(_,i)=>media(128+i)),
      TotalRecordCount:total
    })),
    fetcher
  };
}

describe("G7y-like native metadata sampling",()=>{
  it("keeps recent and archived pages below four batches/512 titles",()=>{
    expect(CANDIDATE_BATCH_SIZE).toBe(128);
    expect(candidateOffsets(USER,0,date)).toEqual([]);
    expect(candidateOffsets(USER,120,date)).toEqual([]);
    expect(candidateOffsets(USER,129,date)).toEqual([128]);
    expect(candidateOffsets(USER,320,date)).toEqual([128,256]);
    expect(candidateOffsets(USER,512,date)).toEqual([128,256,384]);
    const sampled=candidateOffsets(USER,8000,date);
    expect(sampled).toHaveLength(3);
    expect(sampled[0]).toBe(128);
    expect(new Set(sampled).size).toBe(3);
    expect(sampled.every(o=>o>=128 && o<16384 && o%128===0)).toBe(true);
    expect(sampled[1]).toBeLessThan(sampled[2]);
  });
  it("remains stable for one UTC ISO week and is bounded by identity",()=>{
    const first=candidateOffsets(USER,12000,new Date("2026-10-19T10:00:00Z"));
    const second=candidateOffsets(USER,12000,new Date("2026-10-25T23:59:00Z"));
    expect(second).toEqual(first);
    const choices=Array.from({length:8},(_,i)=>candidateOffsets(
      USER,12000,new Date(Date.UTC(2026,9,19+7*i))).join(","));
    expect(new Set(choices).size).toBeGreaterThan(1);
    expect(candidateOffsets(ID(900002),12000,date)).toHaveLength(3);
  });
  it("fails closed on malformed IDs and unsound totals",()=>{
    expect(()=>candidateOffsets("../other-user",100,date))
      .toThrow("CANDIDATE_SCOPE_INVALID");
    expect(()=>candidateOffsets(USER,NaN,date)).toThrow("CANDIDATE_SCOPE_INVALID");
    expect(()=>candidateOffsets(USER,-1,date)).toThrow("CANDIDATE_SCOPE_INVALID");
    expect(()=>candidateOffsets(USER,1e12,date)).toThrow("CANDIDATE_SCOPE_INVALID");
    expect(()=>candidateOffsets(USER,128,new Date(NaN)))
      .toThrow("CANDIDATE_SCOPE_INVALID");
  });
  it("reads up to 512 authorized items from four scoped GETs",async()=>{
    const {api,calls}=fixture(8000);
    await api.login("Alice","secret");
    const found=await api.getCandidates(date);
    expect(found).toHaveLength(512);
    expect(new Set(found.map(r=>r.id)).size).toBe(512);
    const readCalls=calls.filter(c=>c.url.pathname.endsWith("/Items"));
    expect(readCalls).toHaveLength(4);
    expect(readCalls.map(c=>Number(c.url.searchParams.get("StartIndex"))))
      .toEqual([0,...candidateOffsets(USER,8000,date)]);
    for(const c of readCalls){
      expect(c.url.origin).toBe(SERVER_ORIGIN);
      expect(c.url.searchParams.get("Filters")).toBe("IsUnplayed");
      expect(c.url.searchParams.get("Limit")).toBe("128");
      expect(c.url.searchParams.get("EnableTotalRecordCount")).toBe("true");
      expect(c.url.searchParams.get("IncludeItemTypes")).toBe("Movie,Series");
      expect(c.options.credentials).toBe("omit");
      expect(c.options.method).toBe("GET");
      expect(c.url.href).not.toContain(TOKEN);
      expect(c.options.headers).toMatchObject({
        Authorization:expect.stringContaining(TOKEN)
      });
    }
  });
  it("returns the recent page only when total count is unavailable",async()=>{
    const {api,calls}=fixture(8000,{noTotal:true});
    await api.login("Alice","secret");
    expect(await api.getCandidates(date)).toHaveLength(128);
    expect(calls.filter(c=>c.url.pathname.endsWith("/Items"))).toHaveLength(1);
  });
  it("keeps verified early titles when later metadata pages fail",async()=>{
    const {api,calls}=fixture(512,{errorPage:256});
    await api.login("Alice","secret");
    const found=await api.getCandidates(date);
    expect(found).toHaveLength(256);
    expect(calls.filter(c=>c.url.pathname.endsWith("/Items"))).toHaveLength(3);
  });
  it("rejects duplicate IDs from archive windows without leaking them",async()=>{
    const {api}=fixture(512,{duplicatePage:256});
    await api.login("Alice","secret");
    const found=await api.getCandidates(date);
    expect(found).toHaveLength(256);
    expect(new Set(found.map(x=>x.id)).size).toBe(256);
  });
  it("rejects old-session candidate pages even after logout mid-fetch",async()=>{
    const {api,calls,resolve}=fixture(512,{delayedPage:128});
    await api.login("Alice","secret");
    const pending=api.getCandidates(date);
    await vi.waitFor(()=>expect(calls.some(c=>
      c.url.searchParams.get("StartIndex")==="128")).toBe(true));
    api.logout();
    resolve();
    await expect(pending).rejects.toThrow("SESSION_CHANGED");
    expect(calls.filter(c=>c.url.pathname.endsWith("/Items"))).toHaveLength(2);
  });
});
