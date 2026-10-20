import {describe,it,expect} from "vitest";
import {g7yVerifiedPages} from "../src/g7y-verified-pages";

const paris=new Date("2026-10-20T10:00:00Z");
const a="a".repeat(32),b="b".repeat(32);
describe("G7y exact SHA256 weekly Jellyfin verification windows",()=>{
 it("matches the Python server's deterministic page vectors",async()=>{
   expect(await g7yVerifiedPages(a,2000,paris)).toEqual([0,1,2,14]);
   expect(await g7yVerifiedPages(b,2000,paris)).toEqual([0,1,6,15]);
   expect(await g7yVerifiedPages(a,16384,paris)).toEqual([0,1,2,105]);
   expect(await g7yVerifiedPages(b,16384,paris)).toEqual([0,1,41,78]);
 });
 it("covers small libraries without inventing a page",async()=>{
   for(const [total,pages] of [
     [0,[0]],[1,[0]],[128,[0]],[129,[0,1]],
     [256,[0,1]],[257,[0,1,2]],[512,[0,1,2,3]],
     [513,[0,1,2,4]],[30000,[0,1,2,105]]
   ] as const){
     expect(await g7yVerifiedPages(a,total,paris)).toEqual(pages);
   }
 });
 it("always binds windows to user identity and ISO week",async()=>{
   expect(await g7yVerifiedPages(a,2000,paris))
     .not.toEqual(await g7yVerifiedPages(b,2000,paris));
   const weekLater=new Date("2026-10-27T10:00:00Z");
   const result=await g7yVerifiedPages(b,16384,weekLater);
   expect(result[0]).toBe(0);
   expect(result[1]).toBe(1);
   expect(new Set(result).size).toBe(4);
 });
 it("keeps ISO week based on N100 Europe/Paris date",async()=>{
   const utcBeforeMidnight=new Date("2026-10-25T23:20:00Z");
   const localMonday=new Date("2026-10-26T00:20:00Z");
   expect(await g7yVerifiedPages(b,16384,utcBeforeMidnight))
      .toEqual(await g7yVerifiedPages(b,16384,localMonday));
 });
 it("rejects forged users, overflow and invalid timestamps",async()=>{
   for(const [id,total,date] of [
     ["../spoof",2000,paris],[a,-1,paris],
     [a,1_000_001,paris],[a,1.2,paris],
     [a,2000,new Date(Number.NaN)]
   ] as const){
     await expect(g7yVerifiedPages(id,total,date))
       .rejects.toThrow("G7Y_PAGES_INVALID");
   }
 });
});

