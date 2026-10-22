import {describe,it,expect,vi} from "vitest";
import {JellyfinApi,SERVER_ORIGIN} from "../src/api";
const USER="a".repeat(32),ITEM="b".repeat(32),SOURCE="c".repeat(32),
  TOKEN="d".repeat(64);
type FetchResponse=(url:URL,options:RequestInit)=>Response|Promise<Response>;
async function session(respond:FetchResponse){
  const calls:{url:URL,options:RequestInit}[]=[];
  const fetcher=vi.fn(async(input:RequestInfo|URL,options:RequestInit={})=>{
    const url=new URL(String(input));
    calls.push({url,options});
    if(url.pathname==="/Users/AuthenticateByName")
      return new Response(JSON.stringify({
        User:{Id:USER,Name:"Test"},AccessToken:TOKEN
      }),{headers:{"Content-Type":"application/json"}});
    if(url.pathname==="/Users/Me")
      return new Response(JSON.stringify({Id:USER,Name:"Test"}),{
        headers:{"Content-Type":"application/json"}
      });
    return respond(url,options);
  }) as typeof fetch;
  const api=new JellyfinApi({fetcher});
  api.enableReadOnlyQa();
  await api.login("Test","fixture");
  return {api,calls};
}
describe("bounded credential-free WebVTT subtitle delivery",()=>{
  it("requests a single bounded Jellyfin origin with token only in headers",async()=>{
    const vtt="\uFEFFWEBVTT\n\n00:00:01.000 --> 00:00:03.000\nBonjour !\n";
    const {api,calls}=await session(()=>new Response(vtt,{
      headers:{"Content-Type":"text/vtt"}
    }));
    const text=await api.getSubtitleVtt(ITEM,SOURCE,5);
    expect(text).toBe(vtt.slice(1));
    const {url,options}=calls.at(-1)!;
    expect(url.origin).toBe(SERVER_ORIGIN);
    expect(url.pathname).toBe(
      "/Videos/"+ITEM+"/"+SOURCE+"/Subtitles/5/Stream.vtt");
    expect(url.search).toBe("");
    expect(url.href).not.toContain(TOKEN);
    expect(options.method).toBe("GET");
    expect(options.credentials).toBe("omit");
    expect(options.redirect).toBe("error");
    expect((options.headers as Record<string,string>).Authorization)
      .toContain(TOKEN);
    expect(calls.every(c=>!c.url.href.includes(TOKEN))).toBe(true);
  });
  it("refuses malformed stream indices and media IDs before making a fetch",async()=>{
    const {api,calls}=await session(()=>new Response("WEBVTT\n"));
    const initial=calls.length;
    for(const index of [-1,1.25,10001,Infinity]){
      await expect(api.getSubtitleVtt(ITEM,SOURCE,index))
        .rejects.toThrow("SUBTITLE_SCOPE_INVALID");
    }
    await expect(api.getSubtitleVtt("../escape",SOURCE,1))
      .rejects.toThrow("SUBTITLE_SCOPE_INVALID");
    await expect(api.getSubtitleVtt(ITEM,"bad",1))
      .rejects.toThrow("SUBTITLE_SCOPE_INVALID");
    expect(calls).toHaveLength(initial);
  });
  it("refuses oversized or invalid subtitle content without leaking source",async()=>{
    for(const response of [
      new Response("<script>bad</script>",{
        headers:{"Content-Type":"text/html"}
      }),
      new Response("WEBVTT\n"+ "x".repeat(768*1024+1)),
      new Response("WEBVTT\n",{headers:{"Content-Length":"9999999"}}),
      new Response("not found",{status:404})
    ]){
      const {api}=await session(()=>response.clone());
      const reason=response.status===404?"SUBTITLE_UNAVAILABLE":
        "SUBTITLE_INVALID";
      await expect(api.getSubtitleVtt(ITEM,SOURCE,3))
        .rejects.toThrow(reason);
    }
  });
  it("rejects reads after logout or a failed connection",async()=>{
    const {api}=await session(()=>new Response("WEBVTT\n"));
    api.logout();
    await expect(api.getSubtitleVtt(ITEM,SOURCE,1))
      .rejects.toThrow("AUTH_REQUIRED");
    const faulty=await session(()=>{throw new Error(
      "Secret URL https://bad.invalid/?api_key=SECRET");});
    await expect(faulty.api.getSubtitleVtt(ITEM,SOURCE,1))
      .rejects.toThrow("SUBTITLE_NETWORK");
  });
});
