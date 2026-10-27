import {createServer} from "node:http";
import type {IncomingMessage,ServerResponse} from "node:http";
import type {AddressInfo} from "node:net";
import {describe,expect,it,vi} from "vitest";
import {JellyfinApi,SERVER_ORIGIN} from "../src/api";
import {PlaybackReporter} from "../src/playback-report";
import type {PlaybackClock,PlaybackReport} from "../src/playback-report";

const USER="c".repeat(32),TOKEN="d".repeat(64);
const FILM="a".repeat(32),FILM_SOURCE="b".repeat(32);
const SERIES="1".repeat(32),EPISODE="2".repeat(32);
const NEXT="3".repeat(32),EPISODE_SOURCE="4".repeat(32);
const FILM_TICKS=1800*10_000_000,EPISODE_TICKS=1200*10_000_000;
const clock=(seconds:number,durationSeconds=1800):PlaybackClock=>({
  positionSeconds:seconds,durationSeconds,paused:false,
  muted:false,volume:0.5799999999999999,canSeek:true
});
const reply=(res:ServerResponse,value:unknown,status=200)=>{
  const body=JSON.stringify(value);
  res.writeHead(status,{"Content-Type":"application/json",
    "Content-Length":String(Buffer.byteLength(body))});
  res.end(body);
};
async function readBody(req:IncomingMessage):Promise<Record<string,unknown>>{
  const chunks:Buffer[]=[];
  let bytes=0;
  for await(const piece of req){
    const chunk=Buffer.from(piece);
    bytes+=chunk.byteLength;
    if(bytes>8192)throw new Error("WIRE_BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  const parsed:unknown=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if(!parsed || typeof parsed!=="object" || Array.isArray(parsed))
    throw new Error("WIRE_BODY_INVALID");
  return parsed as Record<string,unknown>;
}

/** An actual loopback HTTP transport, never a mock Response Promise.
 * A scoped fetcher rewrites the pinned Jellyfin origin to this ephemeral
 * test server. Production credentials and network connections are absent.
 * This verifies HTTP methods, wire JSON, auth headers and 204 semantics,
 * but is NOT evidence of compatibility with a live Jellyfin instance.
 */
describe("Jellyfin playback wire contract over isolated loopback HTTP",()=>{
  it("sends ordered playback reports and reads back disposable user progress",async()=>{
    let filmPosition=0,episodeDone=false,forbidWrites=false;
    let requests=0,rejectedWrites=0;
    const received:Array<{path:string,body:Record<string,unknown>,
      auth:string,method:string}>=[];
    const serverErrors:string[]=[];
    const server=createServer((req,res)=>{
      void (async()=>{
        const url=new URL(req.url??"/","http://127.0.0.1");
        const path=url.pathname;
        if(path==="/Users/AuthenticateByName"){
          expect(req.method).toBe("POST");
          const input=await readBody(req);
          expect(input).toMatchObject({Username:"Disposable",Pw:"fixture"});
          reply(res,{User:{Id:USER,Name:"Disposable"},AccessToken:TOKEN});
          return;
        }
        const auth=String(req.headers.authorization??"");
        expect(auth).toContain('Token="'+TOKEN+'"');
        if(path==="/Users/Me"){
          reply(res,{Id:USER,Name:"Disposable",Policy:{IsDisabled:false}});
          return;
        }
        if(path==="/UserItems/Resume"){
          expect(url.searchParams.get("userId")).toBe(USER);
          reply(res,{Items:filmPosition>0?[{
            Id:FILM,Type:"Movie",Name:"Film QA interrompu",
            RunTimeTicks:FILM_TICKS,ImageTags:{Primary:"yes"},
            UserData:{Played:false,PlaybackPositionTicks:filmPosition}
          }]:[]});
          return;
        }
        if(path==="/Shows/NextUp"){
          expect(url.searchParams.get("userId")).toBe(USER);
          reply(res,{TotalRecordCount:1,Items:[{
            Id:episodeDone?NEXT:EPISODE,SeriesId:SERIES,
            Type:"Episode",Name:episodeDone?"Épisode suivant":"Épisode en cours",
            ParentIndexNumber:1,IndexNumber:episodeDone?2:1,
            RunTimeTicks:EPISODE_TICKS,ImageTags:{Primary:"yes"},
            UserData:{Played:false,PlaybackPositionTicks:0}
          }]});
          return;
        }
        if(path.startsWith("/Sessions/Playing")){
          expect(req.method).toBe("POST");
          const body=await readBody(req);
          requests++;
          if(forbidWrites){
            rejectedWrites++;
            res.writeHead(403);res.end();
            return;
          }
          expect(req.headers["content-type"]).toContain("application/json");
          expect(body.ItemId===FILM || body.ItemId===EPISODE).toBe(true);
          expect(body.PlaySessionId).toBe("e".repeat(32));
          received.push({path,body,auth,method:req.method??""});
          if(path==="/Sessions/Playing/Stopped"){
            if(body.ItemId===FILM)filmPosition=Number(body.PositionTicks);
            if(body.ItemId===EPISODE)
              episodeDone=Number(body.PositionTicks)>=EPISODE_TICKS;
          }
          res.writeHead(204);res.end();
          return;
        }
        throw new Error("UNEXPECTED_WIRE_ROUTE");
      })().catch(error=>{
        serverErrors.push(String(error));
        if(!res.headersSent)res.writeHead(500);
        if(!res.writableEnded)res.end();
      });
    });
    await new Promise<void>((resolve,reject)=>{
      server.once("error",reject);
      server.listen(0,"127.0.0.1",resolve);
    });
    const port=(server.address() as AddressInfo).port;
    const loopback="http://127.0.0.1:"+port;
    const forwarded:Array<{path:string,method:string,auth:string}>=[];
    const fetcher=((input:RequestInfo|URL,init:RequestInit={})=>{
      const requestUrl=new URL(input instanceof Request?input.url:String(input));
      if(requestUrl.origin!==SERVER_ORIGIN)
        throw new Error("UNPINNED_ORIGIN_IN_WIRE_TEST");
      const target=new URL(requestUrl.pathname+requestUrl.search,loopback);
      const headers=new Headers(init.headers);
      forwarded.push({path:requestUrl.pathname,
        method:init.method??"GET",auth:headers.get("Authorization")??""});
      expect(target.searchParams.has("api_key")).toBe(false);
      expect(target.searchParams.has("access_token")).toBe(false);
      return fetch(target,init);
    }) as typeof fetch;
    try{
      const api=new JellyfinApi({fetcher,deviceId:"wire-qa-fixture"});
      await api.login("Disposable","fixture");
      const movie=new PlaybackReporter({
        itemId:FILM,mediaSourceId:FILM_SOURCE,
        playSessionId:"e".repeat(32),playMethod:"Transcode"
      },event=>api.reportPlayback(event));
      movie.playing(clock(8));
      movie.progress(clock(45),true);
      await movie.drain(); // Simulate a real HTTP interval before stopping.
      movie.stop(clock(73));
      await movie.drain();
      expect((await api.getResume()).map(item=>({
        id:item.id,position:item.resumeTicks,progress:item.progress
      }))).toEqual([{id:FILM,position:730_000_000,progress:4}]);
      expect((await api.getNextUp()).map(item=>item.id)).toEqual([EPISODE]);

      const episode=new PlaybackReporter({
        itemId:EPISODE,mediaSourceId:EPISODE_SOURCE,
        playSessionId:"e".repeat(32),playMethod:"DirectStream"
      },event=>api.reportPlayback(event));
      episode.playing(clock(20,1200));
      episode.ended(clock(1198,1200));
      await episode.drain();
      expect((await api.getNextUp()).map(item=>item.id)).toEqual([NEXT]);
      expect(received.map(call=>call.path)).toEqual([
        "/Sessions/Playing","/Sessions/Playing/Progress",
        "/Sessions/Playing/Stopped","/Sessions/Playing",
        "/Sessions/Playing/Stopped"
      ]);
      expect(received.at(-1)?.body).toMatchObject({
        ItemId:EPISODE,PositionTicks:EPISODE_TICKS,Failed:false
      });
      expect(received[0].body.VolumeLevel).toBe(58);
      expect(received.every(call=>call.auth.includes(TOKEN) &&
        call.method==="POST" && !JSON.stringify(call.body).includes(TOKEN)))
        .toBe(true);

      forbidWrites=true;
      const failures=vi.fn();
      const denied=new PlaybackReporter({
        itemId:FILM,mediaSourceId:FILM_SOURCE,
        playSessionId:"e".repeat(32),playMethod:"Transcode"
      },event=>api.reportPlayback(event),failures);
      denied.playing(clock(90));
      denied.progress(clock(105),true);
      denied.stop(clock(110));
      await denied.drain();
      expect(failures).toHaveBeenCalledTimes(1);
      expect(rejectedWrites).toBe(1);
      expect(requests).toBe(6);
      expect((await api.getResume())[0].resumeTicks).toBe(730_000_000);
      expect(forwarded.every(call=>call.method==="POST" ||
        call.method==="GET")).toBe(true);
      expect(serverErrors).toEqual([]);
      api.logout();
    }finally{
      server.closeAllConnections();
      await new Promise<void>((resolve,reject)=>server.close(err=>
        err?reject(err):resolve()));
    }
  });
});
