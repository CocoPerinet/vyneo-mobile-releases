import {describe,it,expect} from "vitest";
import {JellyfinApi} from "../src/api";

const USER="c".repeat(32),ITEM="a".repeat(32),SOURCE="b".repeat(32);
const TOKEN="d".repeat(64);
const auth=(payload:unknown)=>new Response(JSON.stringify(payload),{
  status:200,headers:{"Content-Type":"application/json"}
});
type SubtitleFetch=(options:RequestInit)=>Response|Promise<Response>;
async function authenticated(subtitle:SubtitleFetch):Promise<JellyfinApi>{
  const fetcher=(async(input:RequestInfo|URL,opts:RequestInit={})=>{
    const route=new URL(String(input)).pathname;
    if(route==="/Users/AuthenticateByName")
      return auth({User:{Id:USER,Name:"QA"},AccessToken:TOKEN});
    if(route==="/Users/Me")
      return auth({Id:USER,Name:"QA",Policy:{IsDisabled:false}});
    if(route==="/Videos/"+ITEM+"/"+SOURCE+"/Subtitles/2/Stream.vtt")
      return subtitle(opts);
    throw new Error("UNEXPECTED_ROUTE");
  }) as typeof fetch;
  const api=new JellyfinApi({fetcher});
  await api.login("QA","fixture");
  return api;
}
describe("bounded, cancellable subtitle loading",()=>{
  it("identifies fetch timeout without exposing upstream exception",async()=>{
    const api=await authenticated(async()=>{
      throw new DOMException(
        "https://private.invalid/?api_key=SECRET","TimeoutError");
    });
    await expect(api.getSubtitleVtt(ITEM,SOURCE,2))
      .rejects.toThrow("SUBTITLE_TIMEOUT");
  });
  it("classifies deadline failure while reading the response stream",async()=>{
    const api=await authenticated(()=>new Response(
      new ReadableStream<Uint8Array>({
        start(controller){
          controller.error(new DOMException("deadline","TimeoutError"));
        }
      }),{status:200,headers:{"Content-Type":"text/vtt"}}
    ));
    await expect(api.getSubtitleVtt(ITEM,SOURCE,2))
      .rejects.toThrow("SUBTITLE_TIMEOUT");
  });
  it("cancels a pending subtitle fetch on track change",async()=>{
    let observed:AbortSignal|undefined;
    const api=await authenticated(opts=>{
      observed=opts.signal??undefined;
      return new Promise<Response>((_resolve,reject)=>{
        if(observed?.aborted){
          reject(new DOMException("cancelled","AbortError"));
          return;
        }
        observed?.addEventListener("abort",()=>{
          reject(new DOMException("cancelled","AbortError"));
        },{once:true});
      });
    });
    const controller=new AbortController();
    const pending=api.getSubtitleVtt(ITEM,SOURCE,2,controller.signal);
    expect(observed?.aborted).toBe(false);
    controller.abort();
    expect(observed?.aborted).toBe(true);
    await expect(pending).rejects.toThrow("SUBTITLE_CANCELLED");
  });
  it("keeps real network failures distinct from extraction timeout",async()=>{
    const api=await authenticated(async()=>{
      throw new Error("signed?token=SECRET");
    });
    await expect(api.getSubtitleVtt(ITEM,SOURCE,2))
      .rejects.toThrow("SUBTITLE_NETWORK");
  });
  it("still accepts valid VTT and rejects invalid subtitle data",async()=>{
    const valid=await authenticated(()=>new Response(
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n",
      {status:200,headers:{"Content-Type":"text/vtt"}}
    ));
    expect(await valid.getSubtitleVtt(ITEM,SOURCE,2))
      .toContain("WEBVTT\n");
    const bad=await authenticated(()=>new Response(
      "not a WebVTT file",
      {status:200,headers:{"Content-Type":"text/plain"}}
    ));
    await expect(bad.getSubtitleVtt(ITEM,SOURCE,2))
      .rejects.toThrow("SUBTITLE_INVALID");
  });
});
