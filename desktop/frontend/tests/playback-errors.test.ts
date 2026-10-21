import {describe,it,expect} from "vitest";
import {
  unavailablePlaybackMessage,nativeHlsFailureMessage,
  htmlVideoFailureMessage
} from "../src/playback-errors";
import type {PlaybackProbe,PlaybackSource} from "../src/types";
const source:PlaybackSource={
  id:"a".repeat(32),title:"Remote stream",container:"MP4",
  bitrate:5000000,directPlay:true,directStream:false,
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
