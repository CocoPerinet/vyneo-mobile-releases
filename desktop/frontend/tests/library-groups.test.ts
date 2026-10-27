import {describe,it,expect,vi} from "vitest";
import {JellyfinApi,SERVER_ORIGIN} from "../src/api";
const uid="a".repeat(32),token="t".repeat(52);
const id=(n:number)=>n.toString(16).padStart(32,"0");
const dto=(n:number,type:string)=>({
  Id:id(n),Type:type,Name:type+" "+n,
  ImageTags:{Primary:"img"},UserData:{IsFavorite:false,Played:false}
});
const output=(value:unknown,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{"Content-Type":"application/json"}
});
function fixture({denied=false}:{denied?:boolean}={}){
  const calls:Array<{url:URL;options:RequestInit}>=[];
  const boxes=Array.from({length:53},(_,i)=>dto(2000+i,"BoxSet"));
  const lists=Array.from({length:3},(_,i)=>dto(3000+i,"Playlist"));
  const mock=vi.fn(async(request:RequestInfo|URL,options:RequestInit={})=>{
    const url=new URL(String(request)),path=url.pathname,qs=url.searchParams;
    calls.push({url,options});
    if(path==="/Users/AuthenticateByName")
      return output({User:{Id:uid,Name:"Alice"},AccessToken:token});
    if(path==="/Users/Me")
      return output({Id:uid,Name:"Alice",Policy:{IsDisabled:false}});
    if(path==="/Users/"+uid+"/Items"){
      if(qs.has("ParentId")){
        if(denied)return output({message:"Denied"},403);
        return output({Items:[dto(10,"Movie"),dto(11,"Episode")],
          TotalRecordCount:2});
      }
      const start=Number(qs.get("StartIndex")),
        limit=Number(qs.get("Limit")),kind=qs.get("IncludeItemTypes");
      const available=kind==="BoxSet"?boxes:kind==="Playlist"?lists:[];
      return output({Items:available.slice(start,start+limit),
        TotalRecordCount:available.length});
    }
    if(path==="/Playlists/"+id(3000)+"/Items"){
      if(denied)return output({message:"Denied"},403);
      return output({Items:[dto(10,"Movie"),dto(12,"Series"),
        dto(13,"Episode")],TotalRecordCount:3});
    }
    return output({Items:[]});
  }) as typeof fetch;
  return {api:new JellyfinApi({fetcher:mock}),calls};
}
describe("collections and playlists remain scoped, read-only Jellyfin pages",()=>{
  it("paginates all 53 collections without cross-library content",async()=>{
    const {api,calls}=fixture();
    await api.login("Alice","password");
    const first=await api.getLibraryGroupPage("BoxSet");
    expect(first.items).toHaveLength(48);
    expect(first.nextOffset).toBe(48);
    const second=await api.getLibraryGroupPage("BoxSet",48);
    expect(second.items).toHaveLength(5);
    expect(second.nextOffset).toBeNull();
    expect(new Set([...first.items,...second.items].map(x=>x.id)).size)
      .toBe(53);
    const paths=calls.filter(x=>x.url.pathname==="/Users/"+uid+"/Items");
    expect(paths.every(x=>x.url.searchParams.get("IncludeItemTypes")
      ==="BoxSet")).toBe(true);
  });
  it("retrieves only authorized media from a collection by validated ParentId",async()=>{
    const {api,calls}=fixture();
    await api.login("Alice","password");
    const result=await api.getLibraryGroupContents("BoxSet",id(2000));
    expect(result.items.map(x=>x.type)).toEqual(["Movie","Episode"]);
    expect(result.nextOffset).toBeNull();
    const request=calls.find(x=>
      x.url.searchParams.get("ParentId")===id(2000))!;
    expect(request.url.searchParams.get("Recursive")).toBe("false");
    expect(request.url.searchParams.get("EnableUserData")).toBe("true");
    expect(request.url.searchParams.get("IncludeItemTypes"))
      .toBe("Movie,Series,Episode");
    expect(request.url.pathname).toBe("/Users/"+uid+"/Items");
  });
  it("gets ordered playlist entries using the documented read endpoint",async()=>{
    const {api,calls}=fixture();
    await api.login("Alice","password");
    const roots=await api.getLibraryGroupPage("Playlist");
    expect(roots.items).toHaveLength(3);
    expect(roots.items.every(x=>x.type==="Playlist")).toBe(true);
    const entries=await api.getLibraryGroupContents("Playlist",id(3000));
    expect(entries.items.map(x=>x.type))
      .toEqual(["Movie","Series","Episode"]);
    const request=calls.find(x=>x.url.pathname==="/Playlists/"+
      id(3000)+"/Items")!;
    expect(request.url.searchParams.get("userId")).toBe(uid);
    expect(request.url.searchParams.get("EnableUserData")).toBe("true");
    expect(request.url.searchParams.get("StartIndex")).toBe("0");
    expect(request.options.method).toBe("GET");
    expect(request.options.credentials).toBe("omit");
    expect(calls.every(x=>x.url.origin===SERVER_ORIGIN &&
      !x.url.href.includes(token))).toBe(true);
  });
  it("rejects invalid groups, pagination and denied membership",async()=>{
    const {api,calls}=fixture({denied:true});
    await api.login("Alice","password");
    const before=calls.length;
    await expect(api.getLibraryGroupContents("BoxSet","../../Users"))
      .rejects.toThrow("PAGE_INVALID");
    await expect(api.getLibraryGroupContents("Playlist",id(3000),-1))
      .rejects.toThrow("PAGE_INVALID");
    await expect(api.getLibraryGroupPage("Playlist",0,90))
      .rejects.toThrow("PAGE_INVALID");
    expect(calls).toHaveLength(before);
    await expect(api.getLibraryGroupContents("Playlist",id(3000)))
      .rejects.toThrow("REQUEST_DENIED");
    await expect(api.getLibraryGroupContents("BoxSet",id(2000)))
      .rejects.toThrow("REQUEST_DENIED");
    api.logout();
    await expect(api.getLibraryGroupPage("BoxSet"))
      .rejects.toThrow("AUTH_REQUIRED");
  });
});
