import {describe,it,expect,vi} from "vitest";
import {JellyfinApi,SERVER_ORIGIN} from "../src/api";
import {g7yVerifiedPages} from "../src/g7y-verified-pages";

const USER="a".repeat(32),OTHER="b".repeat(32),TOKEN="t".repeat(48);
const date=new Date("2026-10-20T09:00:00Z");
const id=(n:number)=>n.toString(16).padStart(32,"0");
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{"Content-Type":"application/json"}
});
const media=(n:number)=>({Id:id(n+1),Name:"Media "+n,Type:n%2?"Series":"Movie",
 ProductionYear:2025,Genres:["Action"],UserData:{Played:false},
 ImageTags:{Primary:"stamp"},PremiereDate:"2025-02-01"});
function fixture(total:number,options:{
 noTotal?:boolean;badPage?:number;duplicatePage?:number;
 delayedPage?:number
}={}){
 const calls:Array<{url:URL;req:RequestInit}>=[];
 let complete:((answer:Response)=>void)|undefined;
 const fetcher=vi.fn(async(input:RequestInfo|URL,req:RequestInit={})=>{
  const url=new URL(String(input));calls.push({url,req});
  if(url.pathname==="/Users/AuthenticateByName")
   return json({User:{Id:USER},AccessToken:TOKEN});
  if(url.pathname==="/Users/Me")
   return json({Id:USER,Name:"Alice",Policy:{IsDisabled:false}});
  if(url.pathname!=="/Items")throw Error("WRONG_ENDPOINT");
  const start=Number(url.searchParams.get("StartIndex"));
  if(start===options.delayedPage)
   return new Promise<Response>(resolve=>{complete=resolve;});
  if(start===options.badPage)return json({error:"offline"},503);
  const items=Array.from({length:Math.min(128,Math.max(0,total-start))},
   (_,i)=>media(start+i));
  if(start===options.duplicatePage)items[0]=media(0);
  return json({Items:items,...(options.noTotal?{}:
   {TotalRecordCount:total})});
 }) as typeof fetch;
 return {api:new JellyfinApi({fetcher}),calls,
   release:()=>complete?.(json({Items:Array.from({length:128},
     (_,i)=>media(128+i)),TotalRecordCount:total}))};
}
describe("G7y per-account direct Jellyfin verification",()=>{
 it("exactly mirrors server's four SHA256 PremiereDate windows",async()=>{
  const {api,calls}=fixture(2000);
  await api.login("Alice","secret");
  const candidates=await api.getG7yVerificationCandidates(date);
  expect(candidates).toHaveLength(512);
  expect(new Set(candidates.map(x=>x.id)).size).toBe(512);
  const reads=calls.filter(c=>c.url.pathname==="/Items");
  expect(reads.map(c=>Number(c.url.searchParams.get("StartIndex"))))
   .toEqual((await g7yVerifiedPages(USER,2000,date)).map(x=>x*128));
  for(const {url,req} of reads){
   expect(url.origin).toBe(SERVER_ORIGIN);
   expect(url.searchParams.get("userId")).toBe(USER);
   expect(url.searchParams.get("SortBy")).toBe("PremiereDate");
   expect(url.searchParams.get("IsPlayed")).toBe("false");
   expect(url.searchParams.get("Limit")).toBe("128");
   expect(url.searchParams.get("IncludeItemTypes")).toBe("Movie,Series");
   expect(req.credentials).toBe("omit");
   expect(req.method).toBe("GET");
   expect(url.href).not.toContain(TOKEN);
   expect(req.headers).toMatchObject({Authorization:
    expect.stringContaining(TOKEN)});
  }
 });
 it("fails closed to the first authorized page if count is missing",async()=>{
  const {api,calls}=fixture(2000,{noTotal:true});
  await api.login("Alice","secret");
  expect(await api.getG7yVerificationCandidates(date)).toHaveLength(128);
  expect(calls.filter(x=>x.url.pathname==="/Items")).toHaveLength(1);
 });
 it("keeps independently verified early pages if a later page fails",async()=>{
  const {api}=fixture(2000,{badPage:256});
  await api.login("Alice","secret");
  expect(await api.getG7yVerificationCandidates(date)).toHaveLength(256);
 });
 it("rejects duplicate IDs in an older window",async()=>{
  const {api}=fixture(2000,{duplicatePage:256});
  await api.login("Alice","secret");
  expect(await api.getG7yVerificationCandidates(date)).toHaveLength(256);
 });
 it("never displays delayed results from a logged-out account",async()=>{
  const {api,calls,release}=fixture(2000,{delayedPage:128});
  await api.login("Alice","secret");
  const pending=api.getG7yVerificationCandidates(date);
  await vi.waitFor(()=>expect(calls.some(c=>c.url.pathname==="/Items"
   && c.url.searchParams.get("StartIndex")==="128")).toBe(true));
  api.logout();release();
  await expect(pending).rejects.toThrow("SESSION_CHANGED");
  expect(api.session).toBeNull();
 });
 it("refuses a different user's identity even when the token remains valid",async()=>{
  const {api,calls}=fixture(2000);
  await api.login("Alice","secret");
  const result=await api.getG7yVerificationCandidates(date);
  expect(result).toHaveLength(512);
  expect(calls.filter(c=>c.url.pathname==="/Items").every(c=>
   c.url.searchParams.get("userId")!==OTHER)).toBe(true);
 });
});
