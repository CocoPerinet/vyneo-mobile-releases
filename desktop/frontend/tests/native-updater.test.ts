import {describe,it,expect,vi} from "vitest";
import {NativeUpdater,updateNotice,updateFailure} from "../src/native-updater";

describe("manually check signed updates without a second installation",()=>{
  it("invokes only the native updater, never accepts a renderer-provided URL",async()=>{
    const invoked:Array<{name:string;args:unknown}>=[];
    const stub=vi.fn(async(name:string,args?:Record<string,unknown>)=>{
      invoked.push({name,args});
      return "up-to-date";
    });
    const updater=new NativeUpdater(stub,true);
    expect(await updater.check()).toBe("up-to-date");
    expect(invoked).toEqual([{name:"check_signed_update_now",args:undefined}]);
    expect(updateNotice("up-to-date")).toBe("Vynéo est à jour.");
    expect(updateNotice("declined")).toContain("reportée");
    expect(updateNotice("install-started")).toContain("signée");
  });
  it("does not perform a native call outside desktop or on malformed result",async()=>{
    const spy=vi.fn(async()=>{throw Error("SHOULD_NOT_RUN");});
    await expect(new NativeUpdater(spy,false).check())
      .rejects.toThrow("UPDATE_REQUIRES_DESKTOP");
    expect(spy).not.toHaveBeenCalled();
    await expect(new NativeUpdater(async()=>({
      url:"https://evil.example/setup.exe"
    }),true).check()).rejects.toThrow("UPDATE_INVALID_RESPONSE");
    await expect(new NativeUpdater(async()=>"installed",true).check())
      .rejects.toThrow("UPDATE_INVALID_RESPONSE");
  });
  it("maps only fixed error codes, without displaying an unsafe update URL",()=>{
    const secret="https://evil.example/update?token=SECRET";
    for(const err of [
      "UPDATE_BUSY",new Error("UPDATE_CHECK_TIMEOUT"),
      "UPDATE_DOWNLOAD_TIMEOUT","UPDATE_CHECK_FAILED",
      "UPDATE_DOWNLOAD_FAILED","UPDATE_INSTALL_FAILED",
      new Error(secret),secret
    ]){
      const msg=updateFailure(err);
      expect(msg.length).toBeGreaterThan(14);
      expect(msg).not.toContain(secret);
      expect(msg).not.toContain("SECRET");
    }
    expect(updateFailure("UPDATE_BUSY")).toContain("déjà en cours");
    expect(updateFailure("UPDATE_INSTALL_FAILED")).toContain("version actuelle");
  });
});
