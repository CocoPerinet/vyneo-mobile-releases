import {invoke,isTauri} from "@tauri-apps/api/core";

export interface SavedJellyfinSession {
  userId:string;
  username:string;
  accessToken:string;
}
const GUID=/^[a-f0-9]{32}$/i;
const TOKEN=/^[a-z0-9._-]{12,2048}$/i;
export function validSaved(value:unknown):value is SavedJellyfinSession{
  if(!value || typeof value!=="object" || Array.isArray(value))return false;
  const row=value as Record<string,unknown>;
  return typeof row.userId==="string" && GUID.test(row.userId) &&
    typeof row.username==="string" && row.username.trim().length>0 &&
    row.username.length<=96 && !/[\u0000-\u001f]/.test(row.username) &&
    typeof row.accessToken==="string" && TOKEN.test(row.accessToken);
}
type Invoke=(name:string,args?:Record<string,unknown>)=>Promise<unknown>;
export class CredentialVault {
  constructor(private call:Invoke=invoke,
              readonly available:boolean=isTauri()){}
  async read():Promise<SavedJellyfinSession|null>{
    if(!this.available)return null;
    const value=await this.call("read_saved_session");
    if(value===null)return null;
    if(!validSaved(value))throw new Error("VAULT_INVALID_SESSION");
    return value;
  }
  async save(record:SavedJellyfinSession):Promise<void>{
    if(!this.available)return;
    if(!validSaved(record))throw new Error("VAULT_INVALID_SESSION");
    await this.call("save_saved_session",{
      userId:record.userId,username:record.username,
      accessToken:record.accessToken
    });
  }
  async clear():Promise<void>{
    if(!this.available)return;
    await this.call("forget_saved_session");
  }
}
export const nativeVault=new CredentialVault();
