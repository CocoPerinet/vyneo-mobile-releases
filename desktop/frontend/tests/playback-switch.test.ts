import {describe,expect,it} from "vitest";
import {capturePlaybackSwitch,shouldAutoplayAfterSwitch}
  from "../src/playback-switch";

describe("native track switch retains playback intent",()=>{
  it("preserves zero seek, mute, volume and an intentional pause",()=>{
    const snapshot=capturePlaybackSwitch({
      currentTime:0,volume:0.25,muted:true,paused:true
    });
    expect(snapshot).toEqual({
      seekSeconds:0,volume:0.25,muted:true,paused:true
    });
    expect(shouldAutoplayAfterSwitch(snapshot.paused)).toBe(false);
    // An exact zero is a valid player position, not a null resume fallback.
    expect(snapshot.seekSeconds??96).toBe(0);
  });
  it("resumes automatically only when the previous media was playing",()=>{
    const snapshot=capturePlaybackSwitch({
      currentTime:182.375,volume:1,muted:false,paused:false
    });
    expect(snapshot.seekSeconds).toBe(182.375);
    expect(shouldAutoplayAfterSwitch(snapshot.paused)).toBe(true);
    expect(shouldAutoplayAfterSwitch(null)).toBe(true);
    expect(shouldAutoplayAfterSwitch(true)).toBe(false);
  });
  it("ignores invalid capture values and does not fabricate a seek",()=>{
    const empty=capturePlaybackSwitch(null);
    expect(empty).toEqual({
      seekSeconds:null,volume:null,muted:null,paused:null
    });
    const corrupted=capturePlaybackSwitch({
      currentTime:NaN,volume:Infinity,muted:false,paused:true
    });
    expect(corrupted.seekSeconds).toBeNull();
    expect(corrupted.volume).toBeNull();
    expect(corrupted.paused).toBe(true);
    expect(capturePlaybackSwitch({
      currentTime:-2,volume:1.5,muted:false,paused:false
    })).toMatchObject({seekSeconds:null,volume:null});
  });
});
