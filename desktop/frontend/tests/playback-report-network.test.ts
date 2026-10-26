import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {describe,expect,it,vi} from "vitest";
import {JellyfinApi,SERVER_ORIGIN} from "../src/api";
import {PlaybackReporter} from "../src/playback-report";
import type {PlaybackReport} from "../src/playback-report";

// This is a real TCP/HTTP integration test with a disposable IN-MEMORY
// fixture, not a writable Jellyfin server. Never route a report to family
// Jellyfin: the fetcher rewrites every authorized production-origin URL
// to this one-use 127.0.0.1 listener.
describe("playback report transport over an isolated loopback socket",()=>{
  it("sends one final Stopped after a real socket failure on Progress",async()=>{
    const user="c".repeat(32),token="d".repeat(64);
    const item="a".repeat(32),source="b".repeat(32);
    const paths:string[]=[];
    const positions:number[]=[];
    const authorized:boolean[]=[];
    const server=createServer((request,response)=>{
      const path=new URL(request.url??"/","http://127.0.0.1").pathname;
      let body="";
      request.setEncoding("utf8");
      request.on("data",(chunk:string)=>{body+=chunk;});
      request.on("end",()=>{
        if(path==="/Users/AuthenticateByName"){
          response.writeHead(200,{"Content-Type":"application/json"});
          response.end(JSON.stringify({
            User:{Id:user,Name:"Alice"},AccessToken:token
          }));
          return;
        }
        if(path==="/Users/Me"){
          response.writeHead(200,{"Content-Type":"application/json"});
          response.end(JSON.stringify({
            Id:user,Name:"Alice",Policy:{IsDisabled:false}
          }));
          return;
        }
        if(![
          "/Sessions/Playing",
          "/Sessions/Playing/Progress",
          "/Sessions/Playing/Stopped"
        ].includes(path)){
          response.writeHead(404);
          response.end();
          return;
        }
        paths.push(path);
        authorized.push((request.headers.authorization??"")
          .includes('Token="'+token+'"'));
        const report=JSON.parse(body) as {PositionTicks:number};
        positions.push(report.PositionTicks);
        if(path==="/Sessions/Playing/Progress"){
          // Real TCP disconnect, not a thrown fake fetch promise.
          request.socket.destroy();
          return;
        }
        response.writeHead(204);
        response.end();
      });
    });
    await new Promise<void>((resolve,reject)=>{
      server.once("error",reject);
      server.listen(0,"127.0.0.1",()=>{
        server.off("error",reject);
        resolve();
      });
    });
    const port=(server.address() as AddressInfo).port;
    const loopback="http://127.0.0.1:"+port;
    const fetcher:typeof fetch=(input,options)=>{
      const requested=new URL(String(input));
      if(requested.origin!==SERVER_ORIGIN)
        throw new Error("NON_JELLYFIN_ORIGIN_BLOCKED");
      return fetch(new URL(requested.pathname+requested.search,loopback),
        options);
    };
    const api=new JellyfinApi({fetcher});
    try{
      await api.login("Alice","disposable-only");
      const errors=vi.fn();
      const reporter=new PlaybackReporter({
        itemId:item,mediaSourceId:source,playSessionId:null,
        playMethod:"Transcode"
      },api.playbackWriter(),errors);
      const clock=(second:number)=>({
        positionSeconds:second,durationSeconds:1800,paused:false,
        muted:false,volume:0.5,canSeek:true
      });
      reporter.playing(clock(5));
      await reporter.drain();
      reporter.progress(clock(20),true);
      await reporter.drain();
      reporter.progress(clock(24),true); // Suppressed after network failure.
      reporter.stop(clock(32));
      reporter.stop(clock(35)); // Must remain idempotent.
      await reporter.drain();
      expect(paths).toEqual([
        "/Sessions/Playing",
        "/Sessions/Playing/Progress",
        "/Sessions/Playing/Stopped"
      ]);
      expect(positions).toEqual([50_000_000,200_000_000,320_000_000]);
      expect(authorized).toEqual([true,true,true]);
      expect(errors).toHaveBeenCalledTimes(1);
    }finally{
      api.logout();
      server.closeAllConnections();
      await new Promise<void>(resolve=>server.close(()=>resolve()));
    }
  });
});
