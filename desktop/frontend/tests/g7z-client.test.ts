import {describe,it,expect,vi} from "vitest";
import {G7zClient} from "../src/g7z-client";
const uid="a".repeat(32);
describe("G7z native-only IPC",()=>{
 it("accepts only exact pair response, never returns bearer tokens",async()=>{
   const bridge=new G7zClient(async()=>
     ({state:"LINK_REQUIRED",userCode:"ABCDEFGHJKM2",
       expiresInSeconds:300}),true);
   expect(await bridge.begin(uid)).toEqual({
     state:"LINK_REQUIRED",userCode:"ABCDEFGHJKM2",expiresInSeconds:300
   });
   const attacker=new G7zClient(async()=>({
     state:"LINK_REQUIRED",userCode:"ABCDEFGHJKM2",expiresInSeconds:300,
     token:"oauth:stolen"
   }),true);
   await expect(attacker.begin(uid)).rejects.toThrow(
     "G7Z_LINK_CONTRACT_DENIED");
 });
 it("does not permit malformed identities or alternate account",async()=>{
   const call=vi.fn(async()=>({state:"ALREADY_LINKED"}));
   const bridge=new G7zClient(call,true);
   await expect(bridge.begin("../outside")).rejects.toThrow(
     "G7Z_NATIVE_UNAVAILABLE");
   expect(await bridge.begin(uid)).toEqual({state:"ALREADY_LINKED"});
   expect(call).toHaveBeenCalledTimes(1);
   expect(call).toHaveBeenCalledWith("g7z_begin",{userId:uid});
 });
 it("never contacts native backend when used in an ordinary browser",async()=>{
   const call=vi.fn();
   const bridge=new G7zClient(call,false);
   await expect(bridge.begin(uid)).rejects.toThrow("G7Z_NATIVE_UNAVAILABLE");
   expect(await bridge.linked(uid)).toBe(false);
   await bridge.forget();
   expect(call).not.toHaveBeenCalled();
 });
 it("only permits personal or rotating models, never arbitrary endpoints",async()=>{
   const call=vi.fn(async()=>({schema:"vyneo.g7x.private_rotating_shelves.v1"}));
   const bridge=new G7zClient(call,true);
   expect(await bridge.suggestions(uid,"rotating")).toBeTruthy();
   expect(call).toHaveBeenCalledWith("g7z_recommendations",
      {userId:uid,kind:"rotating"});
   await expect(bridge.suggestions(uid,"admin" as "personal"))
     .rejects.toThrow("G7Z_NATIVE_DENIED");
 });
 it("keeps a failed status check fail-closed and forget explicit",async()=>{
   const call=vi.fn(async(command:string)=>{
     if(command==="g7z_is_linked")throw Error("offline");
     return null;
   });
   const bridge=new G7zClient(call,true);
   expect(await bridge.linked(uid)).toBe(false);
   await bridge.forget();
   expect(call).toHaveBeenCalledWith("g7z_forget");
 });
});

