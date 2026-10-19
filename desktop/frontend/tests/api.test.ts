import {describe,it,expect,vi} from "vitest";
import {JellyfinApi,SERVER_ORIGIN,parseItems} from "../src/api";

const USER="a".repeat(32),OTHER="b".repeat(32),ITEM="c".repeat(32);
const TOKEN="z".repeat(52);
const respond=(data:unknown,status=200)=>
  new Response(JSON.stringify(data),{status,
    headers:{"Content-Type":"application/json"}});
function fixture(){
  const calls:Array<{url:string;opts:RequestInit}>=[];
  const fetcher=vi.fn(async (url:RequestInfo|URL,opts:RequestInit={})=>{
    const text=String(url),path=new URL(text).pathname;
    calls.push({url:text,opts});
    if(path==="/Users/AuthenticateByName")
      return respond({AccessToken:TOKEN,User:{Id:USER,Name:"Alice"}});
    if(path==="/Users/Me")
      return respond({Id:USER,Name:"Alice",Policy:{IsDisabled:false}});
    if(path==="/UserItems/Resume")
      return respond({Items:[{
        Id:ITEM,Name:"Film 1",Type:"Movie",ProductionYear:2021,
        UserData:{PlaybackPositionTicks:40,Played:false},
        RunTimeTicks:100,
        ImageTags:{Primary:"x"},BackdropImageTags:["y"]
      }]});
    if(path.startsWith("/Items/") && path.includes("/Images/"))
      return new Response(new Blob(["jpeg-blob"],{type:"image/jpeg"}),
        {headers:{"Content-Type":"image/jpeg"}});
    return respond({Items:[]});
  }) as typeof fetch;
  return {fetcher,calls};
}
describe("Jellyfin native metadata client",()=>{
  it("authenticates against the pinned origin and keeps token out of URLs",async()=>{
    const {fetcher,calls}=fixture(),api=new JellyfinApi({fetcher,deviceId:"test-desktop"});
    expect(await api.login(" Alice ","correct horse battery staple"))
      .toEqual({userId:USER,username:"Alice"});
    const cards=await api.getResume();
    expect(cards).toHaveLength(1);
    expect(cards[0].progress).toBe(40);
    expect(cards[0].hasBackdrop).toBe(true);
    expect(calls.every(c=>c.url.startsWith(SERVER_ORIGIN))).toBe(true);
    expect(calls.every(c=>!c.url.includes(TOKEN))).toBe(true);
    expect(calls.every(c=>c.opts.credentials==="omit")).toBe(true);
    expect(calls[1].opts.headers).toMatchObject({
      Authorization:expect.stringContaining(TOKEN)
    });
    expect(calls.at(-1)?.url).toContain("userId="+USER);
    api.logout();
    expect(api.session).toBeNull();
    await expect(api.getResume()).rejects.toThrow("AUTH_REQUIRED");
  });
  it("cannot restore a logged-out session after a late identity reply",async()=>{
    let finish:((response:Response)=>void)|undefined;
    const {fetcher}=fixture();
    const delayed=vi.fn((url:RequestInfo|URL,opts?:RequestInit)=>{
      if(new URL(String(url)).pathname==="/Users/Me")
        return new Promise<Response>(resolve=>{finish=resolve;});
      return fetcher(url,opts);
    }) as typeof fetch;
    const api=new JellyfinApi({fetcher:delayed});
    const pending=api.login("Alice","secret");
    await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));
    api.logout();
    finish!(respond({Id:USER,Name:"Alice"}));
    await expect(pending).rejects.toThrow("LOGIN_CANCELLED");
    expect(api.session).toBeNull();
    await expect(api.getRecent()).rejects.toThrow("AUTH_REQUIRED");
  });
  it("does not accept forged user ids from the login reply",async()=>{
    const {fetcher}=fixture();
    const forged=vi.fn(async (url:RequestInfo|URL,opts?:RequestInit)=>{
      if(new URL(String(url)).pathname==="/Users/Me")
        return respond({Id:OTHER,Name:"Mallory"});
      return fetcher(url,opts);
    }) as typeof fetch;
    const api=new JellyfinApi({fetcher:forged,deviceId:"test-desktop"});
    await expect(api.login("Alice","any password")).rejects.toThrow("LOGIN_INVALID");
    expect(api.session).toBeNull();
  });
  it("rejects arbitrary origins, malformed library items and token-in-query",async()=>{
    expect(()=>new JellyfinApi({origin:"https://phishing.example"}))
      .toThrow("SERVER_ORIGIN_DENIED");
    expect(parseItems({Items:[{Id:"not-guid",Name:"Secret",Type:"Movie"}]},24))
      .toEqual([]);
    const {fetcher,calls}=fixture(),api=new JellyfinApi({fetcher});
    await api.login("Alice","secure");
    await api.getRecent();
    expect(calls.some(x=>x.url.includes("api_key="))).toBe(false);
  });
  it("accepts image bytes via Authorization headers, not URLs",async()=>{
    const {fetcher,calls}=fixture(),api=new JellyfinApi({fetcher});
    await api.login("Alice","secret");
    const item=parseItems({Items:[{
      Id:ITEM,Name:"Poster",Type:"Movie",ImageTags:{Primary:"stamp"}
    }]},1)[0];
    const blob=await api.image(item,"Primary");
    expect(blob?.type).toBe("image/jpeg");
    const last=calls.at(-1)!;
    expect(last.url).not.toContain(TOKEN);
    expect(last.url).toContain("/Images/Primary");
    expect(last.opts.headers).toMatchObject({
      Authorization:expect.stringContaining(TOKEN)
    });
  });
});
