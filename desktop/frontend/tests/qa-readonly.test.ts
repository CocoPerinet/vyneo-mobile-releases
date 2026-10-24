import {describe,it,expect,vi} from "vitest";
import {JellyfinApi} from "../src/api";
import type {PlaybackReport} from "../src/playback-report";

const USER="a".repeat(32),ITEM="b".repeat(32),SOURCE="c".repeat(32);
const TOKEN="d".repeat(64),SESSION="e".repeat(32);
const response=(value:unknown)=>new Response(JSON.stringify(value),{
  headers:{"Content-Type":"application/json"}
});
const report:PlaybackReport={
  kind:"start",itemId:ITEM,mediaSourceId:SOURCE,
  playSessionId:SESSION,playMethod:"Transcode",positionTicks:0,
  isPaused:false,isMuted:false,volumeLevel:50,canSeek:true
};

describe("real-account QA is read-only while media negotiation remains possible",()=>{
  it("allows authenticated playback negotiation but forbids all watch/favorite writes",async()=>{
    const calls:Array<{url:URL,method:string}>=[];
    const fetcher=vi.fn(async(input:RequestInfo|URL,options:RequestInit={})=>{
      const url=new URL(String(input)),method=options.method??"GET";
      calls.push({url,method});
      if(url.pathname==="/Users/AuthenticateByName")
        return response({User:{Id:USER,Name:"QA"},AccessToken:TOKEN});
      if(url.pathname==="/Users/Me")
        return response({Id:USER,Name:"QA"});
      if(url.pathname==="/Items/"+ITEM+"/PlaybackInfo")
        return response({PlaySessionId:SESSION,MediaSources:[]});
      throw new Error("UNEXPECTED_MUTATION");
    }) as typeof fetch;
    const api=new JellyfinApi({fetcher});
    api.enableReadOnlyQa();
    api.enableReadOnlyQa();
    await api.login("QA","mock-only");
    const allowed=await api.negotiatePlaybackInfo(ITEM);
    expect(allowed.probe.sources).toHaveLength(0);
    const before=calls.length;
    await expect(api.reportPlayback(report)).rejects.toThrow("QA_READ_ONLY");
    await expect(api.reportPlayback({...report,kind:"progress"}))
      .rejects.toThrow("QA_READ_ONLY");
    await expect(api.reportPlayback({...report,kind:"stopped"}))
      .rejects.toThrow("QA_READ_ONLY");
    await expect(api.updateMediaState(ITEM,"favorite",true))
      .rejects.toThrow("QA_READ_ONLY");
    await expect(api.updateMediaState(ITEM,"favorite",false))
      .rejects.toThrow("QA_READ_ONLY");
    await expect(api.updateMediaState(ITEM,"played",true))
      .rejects.toThrow("QA_READ_ONLY");
    await expect(api.updateMediaState(ITEM,"played",false))
      .rejects.toThrow("QA_READ_ONLY");
    expect(calls).toHaveLength(before);
    expect(calls.map(c=>[c.url.pathname,c.method])).toEqual([
      ["/Users/AuthenticateByName","POST"],
      ["/Users/Me","GET"],
      ["/Items/"+ITEM+"/PlaybackInfo","POST"]
    ]);
    expect(calls.every(({url})=>!url.href.includes(TOKEN))).toBe(true);
  });
});
