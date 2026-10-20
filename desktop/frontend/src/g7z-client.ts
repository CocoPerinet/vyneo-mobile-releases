import {invoke,isTauri} from "@tauri-apps/api/core";

const USER=/^[0-9a-f]{32}$/i;
const CODE=/^[A-HJ-NP-Z2-9]{12}$/;
export type NativeLinkState=
 {state:"ALREADY_LINKED"} |
 {state:"LINK_REQUIRED";userCode:string;expiresInSeconds:300};
type Invoke=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
const strict=(v:unknown,fields:string[]):v is Record<string,unknown>=>
 !!v && typeof v==="object" && !Array.isArray(v) &&
 Object.keys(v).length===fields.length &&
 fields.every(field=>Object.prototype.hasOwnProperty.call(v,field));

export class G7zClient{
 constructor(private call:Invoke=invoke,readonly available:boolean=isTauri()){}
 private check(userId:string){
   if(!this.available || !USER.test(userId))
     throw new Error("G7Z_NATIVE_UNAVAILABLE");
 }
 async begin(userId:string):Promise<NativeLinkState>{
   this.check(userId);
   const result=await this.call("g7z_begin",{userId});
   if(strict(result,["state"]) && result.state==="ALREADY_LINKED")
     return {state:"ALREADY_LINKED"};
   if(strict(result,["state","userCode","expiresInSeconds"]) &&
      result.state==="LINK_REQUIRED" &&
      typeof result.userCode==="string" && CODE.test(result.userCode) &&
      result.expiresInSeconds===300){
     return {state:"LINK_REQUIRED",userCode:result.userCode,
       expiresInSeconds:300};
   }
   throw new Error("G7Z_LINK_CONTRACT_DENIED");
 }
 async complete(userId:string):Promise<void>{
   this.check(userId);
   const result=await this.call("g7z_complete",{userId});
   if(result!==null && result!==undefined)
     throw new Error("G7Z_LINK_CONTRACT_DENIED");
 }
 async linked(userId:string):Promise<boolean>{
   if(!this.available || !USER.test(userId))return false;
   try{
     const result=await this.call("g7z_is_linked",{userId});
     return result===true;
   }catch{return false;}
 }
 async suggestions(userId:string,kind:"personal"|"rotating"):Promise<unknown>{
   this.check(userId);
   if(kind!=="personal" && kind!=="rotating")
     throw new Error("G7Z_NATIVE_DENIED");
   return this.call("g7z_recommendations",{userId,kind});
 }
 async forget():Promise<void>{
   if(!this.available)return;
   await this.call("g7z_forget");
 }
}
export const g7zClient=new G7zClient();

