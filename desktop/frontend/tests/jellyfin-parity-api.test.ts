import {describe,it,expect,vi} from "vitest";
import {JellyfinApi,normalizeItem,SERVER_ORIGIN} from "../src/api";
const USER="a".repeat(32);
const TOKEN="token".repeat(12);
const id=(n:number)=>n.toString(16).padStart(32,"0");
const now=new Date("2026-10-20T12:00:00Z");
const output=(x:unknown,status=200)=>new Response(JSON.stringify(x),{
  status,headers:{"Content-Type":"application/json"}
});
function episode(n:number){
  return {Id:id(n+1),Type:"Episode",Name:"Episode "+n,
    SeriesId:id(n%2?100:101),SeasonId:id(1000),
    ParentIndexNumber:2,IndexNumber:1,
    PremiereDate:"2026-09-18",UserData:{Played:false}};
}
function series(n:number){
  return {Id:id(n),Type:"Series",Name:"Serie "+n,
    UserData:{PlayedPercentage:70,Played:false},
    ProductionYear:2024,Studios:[{Name:"Marvel Studios"}],
    PremiereDate:"2024-01-01",ImageTags:{Primary:"tag"}};
}
function fixture({nextUpCount=275,failSecond=false,seriesMatchSelection=false}:{
  nextUpCount?:number;failSecond?:boolean;seriesMatchSelection?:boolean
}={}){
  const calls:Array<{url:URL;options:RequestInit}>=[];
  const fetcher=vi.fn(async(u:RequestInfo|URL,options:RequestInit={})=>{
    const url=new URL(String(u)),path=url.pathname;
    calls.push({url,options});
    if(path==="/Users/AuthenticateByName")
      return output({User:{Id:USER,Name:"Alice"},AccessToken:TOKEN});
    if(path==="/Users/Me")
      return output({Id:USER,Name:"Alice",Policy:{IsDisabled:false}});
    if(path==="/Shows/NextUp"){
      const start=Number(url.searchParams.get("StartIndex")??0);
      if(failSecond && start>=300)return output({error:"offline"},503);
      return output({Items:Array.from({
        length:Math.max(0,Math.min(300,nextUpCount-start))
      },(_,i)=>episode(start+i)),TotalRecordCount:nextUpCount});
    }
    if(path==="/Users/"+USER+"/Items"){
      const types=url.searchParams.get("IncludeItemTypes");
      if(types==="Season"){
        return output({Items:[
          {Id:id(1000),SeriesId:id(100),IndexNumber:2,
            PremiereDate:"2026-09-15",Type:"Season"},
          {Id:id(1001),SeriesId:id(101),IndexNumber:1,
            PremiereDate:"2026-07-01",Type:"Season"},
          {Id:id(1002),SeriesId:id(102),IndexNumber:3,
            PremiereDate:"2019-04-01",DateCreated:"2026-10-19",Type:"Season"}
        ]});
      }
      if(types==="Series"){
        if(seriesMatchSelection){
          const selected=url.searchParams.get("Ids")?.split(",")??[];
          return output({Items:selected.map(sid=>({
            ...series(Number.parseInt(sid,16)),Id:sid
          }))});
        }
        return output({Items:[series(100),series(101)]});
      }
      if(types==="Movie,Series"){
        const start=Number(url.searchParams.get("StartIndex"));
        return output({Items:Array.from(
          {length:start===0?200:1},(_,i)=>({
            Id:id(start+i+5000),Type:"Movie",Name:"Film "+(start+i),
            PremiereDate:"2025-01-01",
            ProviderIds:{TmdbCollection:"4455"},
            Studios:[{Name:"Pixar"}]
          })),TotalRecordCount:201});
      }
    }
    if(path.startsWith("/Users/"+USER+"/FavoriteItems/") ||
       path.startsWith("/Users/"+USER+"/PlayedItems/"))
      return new Response(null,{status:204});
    return output({Items:[]});
  }) as typeof fetch;
  return {api:new JellyfinApi({fetcher}),calls,fetcher};
}
describe("Jellyfin UI parity uses real scoped API metadata",()=>{
 it("retrieves all 275 NextUp cards, not the former 24-item cap",async()=>{
   const {api,calls}=fixture();await api.login("Alice","password");
   const entries=await api.getNextUp();
   expect(entries).toHaveLength(275);
   const request=calls.find(x=>x.url.pathname==="/Shows/NextUp")!;
   expect(request.url.searchParams.get("Limit")).toBe("300");
   expect(entries[0].seasonId).toBe(id(1000));
   expect(entries[0].episodeNumber).toBe(1);
 });
 it("reads second NextUp page but keeps first if second times out",async()=>{
   const good=fixture({nextUpCount:450});
   await good.api.login("Alice","password");
   expect(await good.api.getNextUp()).toHaveLength(450);
   expect(good.calls.filter(x=>x.url.pathname==="/Shows/NextUp")
     .map(x=>x.url.searchParams.get("StartIndex"))).toEqual(["0","300"]);
   const interrupted=fixture({nextUpCount:450,failSecond:true});
   await interrupted.api.login("Alice","password");
   const entries=await interrupted.api.getNextUp();
   expect(entries).toHaveLength(300);
 });
 it("identifies recent seasons by PremiereDate, never import date",async()=>{
   const {api,calls}=fixture();await api.login("Alice","password");
   const seasons=await api.getRecentSeasons(now);
   expect(seasons).toEqual([{seriesId:id(100),seasonId:id(1000),
     number:2,premiereDate:"2026-09-15"}]);
   expect(calls.at(-1)?.url.searchParams.get("IncludeItemTypes"))
     .toBe("Season");
   const old=normalizeItem({Id:id(44),Name:"Ancien film",
     Type:"Movie",DateCreated:"2026-10-20",ProductionYear:1976})!;
   expect(old.premiereDate).toBe("");
 });
 it("authorizes only Series connected to returned episodes",async()=>{
   const {api,calls}=fixture();await api.login("Alice","password");
   const entries=await api.getNextUp();
   const evidence=await api.getNextUpSeries(entries);
   expect(evidence).toHaveLength(2);
   expect(evidence.every(x=>x.playedPercentage===70)).toBe(true);
   const last=calls.at(-1)!;
   expect(last.url.searchParams.get("Ids")).toBe([id(101),id(100)].join(","));
   expect(last.url.href).not.toContain(TOKEN);
   expect(last.options.credentials).toBe("omit");
 });
 it("enriches over 300 unique NextUp series without losing the last 150",async()=>{
   const {api,calls}=fixture({seriesMatchSelection:true});
   await api.login("Alice","password");
   const prototype=normalizeItem(episode(0))!;
   const items=Array.from({length:450},(_,n)=>({
     ...prototype,id:id(5000+n),seriesId:id(8000+n)
   }));
   const evidence=await api.getNextUpSeries(items);
   expect(evidence).toHaveLength(450);
   expect(evidence[0].id).toBe(id(8000));
   expect(evidence.at(-1)?.id).toBe(id(8449));
   const batches=calls.filter(x=>
     x.url.pathname==="/Users/"+USER+"/Items" &&
     x.url.searchParams.get("IncludeItemTypes")==="Series");
   expect(batches).toHaveLength(8);
   expect(batches.every(x=>(x.url.searchParams.get("Ids")??"")
     .split(",").length<=60)).toBe(true);
   expect(batches.every(x=>!x.url.href.includes(TOKEN) &&
     x.options.credentials==="omit")).toBe(true);
 });
 it("requests sufficient Resume results before filtering stale completed titles",async()=>{
   const {api,calls}=fixture();
   await api.login("Alice","password");
   await api.getResume();
   const resume=calls.find(x=>x.url.pathname==="/UserItems/Resume")!;
   expect(resume.url.searchParams.get("Limit")).toBe("100");
   expect(resume.url.searchParams.get("userId")).toBe(USER);
 });
 it("collects 201 universe items by authorized pages",async()=>{
   const {api,calls}=fixture();await api.login("Alice","password");
   const films=await api.getUniverseCatalog();
   expect(films).toHaveLength(201);
   expect(films[0].franchiseId).toBe("4455");
   expect(calls.filter(x=>x.url.searchParams.get("IncludeItemTypes")==="Movie,Series")
     .map(x=>x.url.searchParams.get("StartIndex"))).toEqual(["0","200"]);
   expect(calls.every(x=>x.url.origin===SERVER_ORIGIN)).toBe(true);
 });
 it("updates favorite/played only for current account with POST/DELETE",async()=>{
   const {api,calls}=fixture();await api.login("Alice","password");
   await api.updateMediaState(id(50),"favorite",true);
   await api.updateMediaState(id(50),"played",false);
   const last=calls.slice(-2);
   expect(last.map(x=>x.url.pathname)).toEqual([
     "/Users/"+USER+"/FavoriteItems/"+id(50),
     "/Users/"+USER+"/PlayedItems/"+id(50)
   ]);
   expect(last.map(x=>x.options.method)).toEqual(["POST","DELETE"]);
   expect(last.every(x=>x.options.credentials==="omit")).toBe(true);
   await expect(api.updateMediaState("../../../other","favorite",true))
     .rejects.toThrow("MEDIA_ACTION_DENIED");
   api.logout();
   await expect(api.updateMediaState(id(50),"favorite",true))
     .rejects.toThrow("AUTH_REQUIRED");
 });
});

