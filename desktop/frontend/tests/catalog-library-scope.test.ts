import {describe,it,expect,vi} from "vitest";
import {JellyfinApi,resolveCatalogLibraryIds,SERVER_ORIGIN} from "../src/api";

const A="a".repeat(32),B="b".repeat(32);
const FILMS="1".repeat(32),SERIES="2".repeat(32),ANIMES="3".repeat(32);
const TOKEN="t".repeat(48);
const views=[
  {Id:ANIMES,Name:"Animes",CollectionType:"tvshows"},
  {Id:FILMS,Name:"Films",CollectionType:"movies"},
  {Id:SERIES,Name:"Séries",CollectionType:"tvshows"},
  {Id:"4".repeat(32),Name:"Animation",CollectionType:"movies"},
  {Id:"5".repeat(32),Name:"Subtitle Canary",CollectionType:"movies"}
];
const respond=(value:unknown,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{"Content-Type":"application/json"}
});
const movie=(id:string,genres=["Animation"])=>({
  Id:id,Name:"Titre "+id.slice(0,2),Type:"Movie",Genres:genres,
  ImageTags:{Primary:"poster"},UserData:{}
});
const series=(id:string,genres=["Anime","Animation"])=>({
  ...movie(id,genres),Type:"Series"
});
function fakeApi(visible=views){
  const calls:URL[]=[];
  const fetcher=vi.fn(async (url:RequestInfo|URL)=>{
    const request=new URL(String(url));
    calls.push(request);
    if(request.pathname==="/Users/AuthenticateByName")
      return respond({User:{Id:A},AccessToken:TOKEN});
    if(request.pathname==="/Users/Me")
      return respond({Id:A,Name:"Alice"});
    if(request.pathname==="/Users/"+A+"/Views")
      return respond({Items:visible});
    if(request.pathname==="/Users/"+A+"/Items"){
      const parent=request.searchParams.get("ParentId");
      return respond({Items:parent===ANIMES?[
        series("6".repeat(32)),movie("7".repeat(32),["Anime"])
      ]:parent===FILMS?[movie("8".repeat(32))]:
        parent===SERIES?[series("9".repeat(32),["Drama"])]:[],
        TotalRecordCount:parent===ANIMES?2:1});
    }
    throw new Error("unexpected request");
  }) as typeof fetch;
  return {api:new JellyfinApi({fetcher}),calls,fetcher};
}
describe("Jellyfin library scoped media catalogs",()=>{
  it("maps only user's real named media library roots",()=>{
    expect(resolveCatalogLibraryIds({Items:views})).toEqual({
      Anime:ANIMES,Movie:FILMS,Series:SERIES
    });
    expect(resolveCatalogLibraryIds({Items:views.filter(v=>v.Name==="Animation")}))
      .toEqual({Anime:null,Movie:null,Series:null});
    expect(()=>resolveCatalogLibraryIds({Items:"not-an-array"}))
      .toThrow("LIBRARIES_INVALID");
  });
  it("keeps Films, Series and Animes separated by ParentId",async()=>{
    const {api,calls}=fakeApi();
    await api.login("Alice","password");
    const films=await api.getCatalogPage("Movie");
    const shows=await api.getCatalogPage("Series");
    const anime=await api.getCatalogPage("Anime");
    expect(films.items.map(i=>i.id)).toEqual(["8".repeat(32)]);
    expect(shows.items.map(i=>i.id)).toEqual(["9".repeat(32)]);
    expect(anime.items.map(i=>i.id)).toEqual(["6".repeat(32),"7".repeat(32)]);
    expect(anime.libraryAvailable).toBe(true);
    expect(calls.filter(u=>u.pathname.endsWith("/Views"))).toHaveLength(1);
    const itemRequests=calls.filter(u=>u.pathname.endsWith("/Items"));
    expect(itemRequests.map(u=>u.searchParams.get("ParentId")))
      .toEqual([FILMS,SERIES,ANIMES]);
    expect(itemRequests.map(u=>u.searchParams.get("IncludeItemTypes")))
      .toEqual(["Movie","Series","Movie,Series"]);
    expect(calls.every(u=>u.origin===SERVER_ORIGIN)).toBe(true);
    expect(calls.every(u=>!u.href.includes(TOKEN))).toBe(true);
  });
  it("never guesses Anime from Animation or another user's library",async()=>{
    const {api,calls}=fakeApi(views.filter(v=>v.Id!==ANIMES));
    await api.login("Alice","password");
    expect(await api.getCatalogPage("Anime")).toEqual({
      items:[],nextOffset:null,total:0,libraryAvailable:false
    });
    expect(calls.filter(u=>u.pathname.endsWith("/Items"))).toHaveLength(0);
  });
  it("invalidates pending library resolution after logout/account switch",async()=>{
    let release!: (r:Response)=>void;
    let loginCount=0;
    const calls:URL[]=[];
    const fetcher=vi.fn(async (url:RequestInfo|URL)=>{
      const u=new URL(String(url));calls.push(u);
      if(u.pathname==="/Users/AuthenticateByName"){
        loginCount++;
        const uid=loginCount===1?A:B;
        return respond({User:{Id:uid},AccessToken:TOKEN});
      }
      if(u.pathname==="/Users/Me")
        return respond({Id:loginCount===1?A:B,Name:"User"});
      if(u.pathname==="/Users/"+A+"/Views")
        return new Promise<Response>(done=>{release=done;});
      if(u.pathname==="/Users/"+B+"/Views")
        return respond({Items:[{Id:FILMS,Name:"Films",CollectionType:"movies"}]});
      if(u.pathname==="/Users/"+B+"/Items")
        return respond({Items:[movie("8".repeat(32))],TotalRecordCount:1});
      throw Error("unexpected endpoint");
    }) as typeof fetch;
    const api=new JellyfinApi({fetcher});
    await api.login("A","password");
    const stale=api.getCatalogPage("Anime");
    await vi.waitFor(()=>expect(release).toBeTypeOf("function"));
    api.logout();
    await api.login("B","password");
    release(respond({Items:views}));
    await expect(stale).rejects.toThrow("SESSION_CHANGED");
    expect((await api.getCatalogPage("Movie")).items).toHaveLength(1);
    expect(calls.filter(u=>u.pathname==="/Users/"+A+"/Items")).toHaveLength(0);
    expect(api.session?.userId).toBe(B);
  });
  it("retries view discovery after a transient HTTP failure",async()=>{
    let tries=0;
    const {api}=fakeApi();
    const fallback=vi.fn(async (url:RequestInfo|URL)=>{
      const pathname=new URL(String(url)).pathname;
      if(pathname==="/Users/"+A+"/Views" && ++tries===1)
        return respond({message:"temporary unavailable"},503);
      const {fetcher}=fakeApi();
      return fetcher(url);
    }) as typeof fetch;
    const client=new JellyfinApi({fetcher:fallback});
    await client.login("Alice","password");
    await expect(client.getCatalogPage("Movie")).rejects.toThrow("REQUEST_DENIED");
    expect((await client.getCatalogPage("Movie")).items).toHaveLength(1);
    expect(tries).toBe(2);
    expect(api.session).toBeNull();
  });
});
