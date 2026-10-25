import {describe,it,expect} from "vitest";
import {
  unavailablePlaybackMessage,nativeHlsFailureMessage,nativeHlsQaDiagnostic,
  htmlVideoFailureMessage,playbackInspectionErrorMessage,
  subtitleFailureMessage
} from "../src/playback-errors";
import type {PlaybackProbe,PlaybackSource} from "../src/types";
const source:PlaybackSource={
  id:"a".repeat(32),title:"Remote stream",container:"MP4",
  bitrate:5000000,runtimeTicks:null,directPlay:true,directStream:false,
  transcoding:false,isRemote:true,tracks:[]
};
const probe=(errorCode:string|null,sources:PlaybackSource[]=[source]):
  PlaybackProbe=>({sources,errorCode});
describe("safe and actionable Jellyfin playback diagnostics",()=>{
  it("distinguishes playback permissions, rate limits and codec negotiation",()=>{
    expect(unavailablePlaybackMessage(probe("NotAllowed")))
      .toContain("autorisé");
    expect(unavailablePlaybackMessage(probe("RateLimitExceeded")))
      .toContain("simultanés");
    expect(unavailablePlaybackMessage(probe("NoCompatibleStream")))
      .toContain("compatible");
    expect(unavailablePlaybackMessage(probe(null)))
      .toContain("source distante");
    expect(unavailablePlaybackMessage(probe(null,[
      {...source,transcoding:true}
    ]))).toContain("URL HLS");
    expect(unavailablePlaybackMessage(probe(null,[])))
      .toContain("aucune source");
  });
  it("explains a slow remote STRM probe without leaking upstream details",()=>{
    expect(playbackInspectionErrorMessage(new Error("REQUEST_TIMEOUT")))
      .toContain("trop de temps");
    expect(playbackInspectionErrorMessage(new Error("REQUEST_TIMEOUT")))
      .toContain("STRM");
    expect(playbackInspectionErrorMessage(new Error("SESSION_EXPIRED")))
      .toContain("Reconnectez-vous");
    expect(playbackInspectionErrorMessage(new Error("NETWORK_UNAVAILABLE")))
      .toContain("connexion");
    expect(playbackInspectionErrorMessage(new Error("REQUEST_DENIED")))
      .toContain("serveur");
    expect(playbackInspectionErrorMessage(new Error("PLAYBACK_INFO_INVALID")))
      .toContain("non exploitables");
    for(const error of [
      new Error("https://private.invalid/?api_key=SECRET"),
      new Error("REQUEST_TIMEOUT https://private.invalid/?api_key=SECRET"),
      {url:"https://private.invalid/?access_token=SECRET"}
    ]){
      const message=playbackInspectionErrorMessage(error);
      expect(message).not.toMatch(/SECRET|api_key|access_token|https?:/);
    }
  });
  it("classifies intermittent HLS 502 using only bounded QA proxy reason",()=>{
    const xhr={getResponseHeader:(name:string)=>
      name==="x-vyneo-qa-hls-reason"?"HLS_UPSTREAM_HTTP_STATUS":null};
    const event={
      type:"networkError",details:"fragLoadError",fatal:false,
      response:{code:502,url:"https://private.invalid/?api_key=SECRET"},
      networkDetails:xhr
    };
    expect(nativeHlsQaDiagnostic(event))
      .toBe("HLS_UPSTREAM_HTTP_STATUS (HTTP 502)");
    expect(nativeHlsQaDiagnostic({...event,fatal:true}))
      .toBe("HLS_UPSTREAM_HTTP_STATUS (HTTP 502)");
    const headers=new Headers({"x-vyneo-qa-hls-reason":"HLS_UPSTREAM_BODY"});
    expect(nativeHlsQaDiagnostic({...event,networkDetails:{headers}}))
      .toBe("HLS_UPSTREAM_BODY (HTTP 502)");
    expect(nativeHlsQaDiagnostic({...event,networkDetails:null,
      loader:{getResponseHeader:()=> "HLS_UPSTREAM_NETWORK"}}))
      .toBe("HLS_UPSTREAM_NETWORK (HTTP 502)");
  });
  it("never reveals untrusted headers, response URLs or tokens in QA output",()=>{
    const evil="HLS_UPSTREAM_HTTP_STATUS?api_key=SECRET&url=https://private.invalid";
    const base={type:"networkError",details:"fragLoadError",
      response:{code:502,url:"https://private.invalid?access_token=SECRET"},
      networkDetails:{headers:new Headers({
        "x-vyneo-qa-hls-reason":evil
      })}};
    expect(nativeHlsQaDiagnostic(base)).toBe("HTTP 502");
    expect(nativeHlsQaDiagnostic({...base,response:{code:200}})).toBeNull();
    expect(nativeHlsQaDiagnostic({...base,type:"mediaError"})).toBeNull();
    expect(nativeHlsQaDiagnostic({...base,response:{code:Infinity}}))
      .toBeNull();
    expect(nativeHlsQaDiagnostic({...base,
      networkDetails:{getResponseHeader:()=>{throw new Error(evil);}}}))
      .toBe("HTTP 502");
    for(const result of [
      nativeHlsQaDiagnostic(base),
      nativeHlsQaDiagnostic({...base,networkDetails:{headers:new Headers({
        "x-vyneo-qa-hls-reason":"HLS_UPSTREAM_NETWORK"
      })}})
    ]){
      expect(result).not.toMatch(/SECRET|api_key|access_token|https?:/);
    }
  });
  it("explains a timed-out subtitle extraction without leaking private URL",()=>{
    expect(subtitleFailureMessage(new Error("SUBTITLE_TIMEOUT")))
      .toContain("95 secondes");
    expect(subtitleFailureMessage(new DOMException("late","TimeoutError")))
      .toContain("95 secondes");
    expect(subtitleFailureMessage(new Error("SUBTITLE_UNAVAILABLE")))
      .toContain("autre piste");
    expect(subtitleFailureMessage(new Error("SESSION_EXPIRED")))
      .toContain("Reconnectez-vous");
    for(const error of [
      new Error("https://secret.invalid/video?api_key=SECRET"),
      new Error("SUBTITLE_TIMEOUT https://secret.invalid?token=SECRET"),
      {response:{url:"https://secret.invalid?token=SECRET"}}
    ]){
      expect(subtitleFailureMessage(error))
        .not.toMatch(/SECRET|token=|api_key|https?:/);
    }
  });
  it("maps network, media and HTMLMediaElement errors without raw details",()=>{
    const secret="https://example.invalid/stream?api_key=SECRET123";
    const network=nativeHlsFailureMessage("networkError",secret);
    const decoder=nativeHlsFailureMessage("mediaError",secret);
    const other=nativeHlsFailureMessage("otherError",secret);
    for(const text of [network,decoder,other]){
      expect(text).not.toMatch(/api_key|SECRET|https?:/);
    }
    expect(network).toContain("connexion");
    expect(decoder).toContain("décoder");
    expect(other).toContain("journaux");
    expect(htmlVideoFailureMessage(3)).toContain("décoder");
    expect(htmlVideoFailureMessage(2)).toContain("réseau");
  });
});
