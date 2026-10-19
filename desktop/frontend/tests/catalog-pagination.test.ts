import {describe,it,expect,vi} from "vitest";
import {JellyfinApi,SERVER_ORIGIN} from "../src/api";

const USER="a".repeat(32),TOKEN="t".repeat(52),MOVIES="1".repeat(32);
const respond=(value:unknown)=>new Response(JSON.stringify(value),{
  headers:{"Content-Type":"application/json"}
});
const item=(index:number,type="Movie")=>({
  Id:index.toString(16).padStart(32,"0"),Name:"Titre "+index,
  Type:type,UserData:{},ImageTags:{Primary:"image"}
});
function fixture(provider:(offset:number,limit:number)=>unknown){
  const calls:Array<{url:string;options:RequestInit}>=[];
  const fetcher=vi.fn(async (url:RequestInfo|URL,options:RequestInit={})=>{
    const parsed=new URL(String(url));
    calls.push({url:String(url),options});
    if(parsed.pathname==="/Users/AuthenticateByName")
      return respond({User:{Id:USER,Name:"Alice"},AccessToken:TOKEN});
    if(parsed.pathname==="/Users/Me")
      return respond({Id:USER,Name:"Alice",Policy:{IsDisabled:false}});
    if(parsed.pathname==="/Users/"+USER+"/Views")
      return respond({Items:[
        {Id:MOVIES,Name:"Films",CollectionType:"movies"},
        {Id:"2".repeat(32),Name:"Animes",CollectionType:"tvshows"},
        {Id:"3".repeat(32),Name:"Séries",CollectionType:"tvshows"}
      ]});
    if(parsed.pathname==="/Users/"+USER+"/Items"){
      expect(parsed.searchParams.get("Recursive")).toBe("true");
      expect(parsed.searchParams.get("ParentId")).toBe(MOVIES);
      expect(parsed.searchParams.get("IncludeItemTypes")).toBe("Movie");
      expect(parsed.searchParams.get("SortBy")).toBe("SortName");
      const offset=Number(parsed.searchParams.get("StartIndex"));
      const limit=Number(parsed.searchParams.get("Limit"));
      return respond(provider(offset,limit));
    }
    throw new Error("Unexpected request");
  }) as typeof fetch;
  return {api:new JellyfinApi({fetcher}),calls};
}

describe("paginated Jellyfin catalog",()=>{
  it("retrieves all records in stable bounded pages",async()=>{
    const films=Array.from({length:105},(_,i)=>item(i+1));
    const {api,calls}=fixture((offset,limit)=>({
      Items:films.slice(offset,offset+limit),TotalRecordCount:films.length
    }));
    await api.login("Alice","test-password");
    const first=await api.getCatalogPage("Movie");
    const second=await api.getCatalogPage("Movie",first.nextOffset!);
    const third=await api.getCatalogPage("Movie",second.nextOffset!);
    expect([first.items.length,second.items.length,third.items.length])
      .toEqual([48,48,9]);
    expect([first.nextOffset,second.nextOffset,third.nextOffset])
      .toEqual([48,96,null]);
    expect(first.total).toBe(105);
    expect(first.libraryAvailable).toBe(true);
    expect(calls.filter(x=>new URL(x.url).pathname==="/Users/"+USER+"/Views")).toHaveLength(1);
    expect(new Set([...first.items,...second.items,...third.items].map(x=>x.id)).size)
      .toBe(105);
    expect(calls.every(x=>x.url.startsWith(SERVER_ORIGIN))).toBe(true);
    expect(calls.every(x=>!x.url.includes(TOKEN))).toBe(true);
    expect(calls.every(x=>x.options.credentials==="omit")).toBe(true);
    api.logout();
    await expect(api.getCatalogPage("Movie")).rejects.toThrow("AUTH_REQUIRED");
  });
  it("paginates favorite-only results inside the chosen library",async()=>{
    const titles=Array.from({length:93},(_,i)=>item(i+1));
    const {api,calls}=fixture((offset,limit)=>({
      Items:titles.slice(offset,offset+limit),TotalRecordCount:titles.length
    }));
    await api.login("Alice","test-password");
    const first=await api.getFavoritePage("Movie");
    const second=await api.getFavoritePage("Movie",first.nextOffset!);
    expect(first.items).toHaveLength(48);
    expect(second.items).toHaveLength(45);
    expect(second.nextOffset).toBeNull();
    const requests=calls.filter(call=>new URL(call.url).pathname.endsWith("/Items"));
    expect(requests.every(call=>
      new URL(call.url).searchParams.get("Filters")==="IsFavorite"
    )).toBe(true);
  });
  it("uses raw consumed offsets even when some media rows are invalid",async()=>{
    const {api}=fixture(offset=>({
      Items:offset===0?[item(1),{Id:"bad-id",Type:"Movie",Name:"Bad"},
        item(2,"Episode"),item(3,"Series")]:[item(4)],
      TotalRecordCount:5
    }));
    await api.login("Alice","test-password");
    const first=await api.getCatalogPage("Movie",0,4);
    expect(first.items.map(x=>x.title)).toEqual(["Titre 1"]);
    expect(first.nextOffset).toBe(4);
    const last=await api.getCatalogPage("Movie",first.nextOffset!,4);
    expect(last.items.map(x=>x.title)).toEqual(["Titre 4"]);
    expect(last.nextOffset).toBeNull();
  });
  it("halts on empty pages despite a stale record count",async()=>{
    const {api}=fixture(()=>({Items:[],TotalRecordCount:100}));
    await api.login("Alice","test-password");
    const page=await api.getCatalogPage("Movie",0);
    expect(page).toEqual({items:[],nextOffset:null,total:100,libraryAvailable:true});
  });
  it("validates limits and rejects malformed catalog payloads",async()=>{
    const {api}=fixture(()=>({wrong:"shape"}));
    await api.login("Alice","test-password");
    await expect(api.getCatalogPage("Movie",-1)).rejects.toThrow("PAGE_INVALID");
    await expect(api.getCatalogPage("Movie",0,1000)).rejects.toThrow("PAGE_INVALID");
    await expect(api.getCatalogPage("Movie",1.3)).rejects.toThrow("PAGE_INVALID");
    await expect(api.getCatalogPage("Movie")).rejects.toThrow("CATALOG_INVALID");
  });
});
