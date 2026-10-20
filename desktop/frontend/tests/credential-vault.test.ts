import {describe,it,expect,vi} from "vitest";
import {CredentialVault,validSaved} from "../src/credential-vault";
import {JellyfinApi} from "../src/api";
const USER="a".repeat(32),OTHER="b".repeat(32),TOKEN="T".repeat(60);
const example={userId:USER,username:"Alex",accessToken:TOKEN};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"Content-Type":"application/json"}
});
describe("Native OS credential vault contract",()=>{
  it("stores, retrieves, clears a validated record via native commands only",async()=>{
    let stored:unknown=null;
    const calls:string[]=[];
    const fake=vi.fn(async(name:string,args?:Record<string,unknown>)=>{
      calls.push(name);
      if(name==="save_saved_session"){stored={
        userId:args?.userId,username:args?.username,accessToken:args?.accessToken
      };return null;}
      if(name==="read_saved_session")return stored;
      if(name==="forget_saved_session"){stored=null;return null;}
      throw Error("Unexpected command");
    });
    const vault=new CredentialVault(fake,true);
    expect(await vault.read()).toBeNull();
    await vault.save(example);
    expect(await vault.read()).toEqual(example);
    await vault.clear();
    expect(await vault.read()).toBeNull();
    expect(calls).toEqual(["read_saved_session","save_saved_session",
      "read_saved_session","forget_saved_session","read_saved_session"]);
  });
  it("never stores a secret in a plain browser-only context",async()=>{
    const fn=vi.fn(async()=>{throw Error("SHOULD_NOT_RUN");});
    const vault=new CredentialVault(fn,false);
    await vault.save(example);
    expect(await vault.read()).toBeNull();
    await vault.clear();
    expect(fn).not.toHaveBeenCalled();
  });
  it("rejects invalid credentials and forbids fallback plaintext",async()=>{
    const fn=vi.fn(async()=>null);
    const vault=new CredentialVault(fn,true);
    for(const invalid of [
      {...example,userId:"../sibling"},
      {...example,username:"User\nAdmin"},
      {...example,accessToken:"t"+"?".repeat(50)},
      {...example,accessToken:"tiny"}
    ]){
      expect(validSaved(invalid)).toBe(false);
      await expect(vault.save(invalid)).rejects.toThrow("VAULT_INVALID_SESSION");
    }
    expect(fn).not.toHaveBeenCalled();
    const malformed=new CredentialVault(async()=>({...example,accessToken:123}),true);
    await expect(malformed.read()).rejects.toThrow("VAULT_INVALID_SESSION");
  });
});
describe("Restore Jellyfin identity on startup",()=>{
  it("rechecks /Users/Me with the stored token, no password or URL leak",async()=>{
    const sent:Array<{url:URL,headers:HeadersInit|undefined}>=[];
    const fetcher=vi.fn(async(input:RequestInfo|URL,init:RequestInit={})=>{
      const url=new URL(String(input));
      sent.push({url,headers:init.headers});
      return response({Id:USER,Name:"Alex",Policy:{IsDisabled:false}});
    }) as typeof fetch;
    const api=new JellyfinApi({fetcher});
    expect(await api.restore(example)).toEqual({userId:USER,username:"Alex"});
    expect(api.session?.userId).toBe(USER);
    expect(api.savedCredential()).toEqual(example);
    expect(sent.map(x=>x.url.pathname)).toEqual(["/Users/Me"]);
    expect(sent[0].url.href).not.toContain(TOKEN);
    expect(sent[0].headers).toMatchObject({
      Authorization:expect.stringContaining(TOKEN)
    });
    api.logout();
    expect(api.savedCredential()).toBeNull();
  });
  it("refuses another account, disabled account, invalid token and expires",async()=>{
    const cases=[
      response({Id:OTHER,Name:"Alex"}),
      response({Id:USER,Name:"Alex",Policy:{IsDisabled:true}}),
      response({},401)
    ];
    for(const reply of cases){
      const api=new JellyfinApi({fetcher:vi.fn(async()=>reply) as typeof fetch});
      await expect(api.restore(example)).rejects.toThrow();
      expect(api.session).toBeNull();
    }
    const api=new JellyfinApi({fetcher:vi.fn(async()=>
      response({Id:USER,Name:"Alex"})) as typeof fetch});
    await expect(api.restore({...example,accessToken:"bad"}))
      .rejects.toThrow("RESTORE_INVALID");
  });
  it("discards a delayed restore after explicit logout",async()=>{
    let complete!:(resp:Response)=>void;
    const api=new JellyfinApi({fetcher:vi.fn(async()=>new Promise<Response>(
      resolve=>{complete=resolve;}
    )) as typeof fetch});
    const pending=api.restore(example);
    await vi.waitFor(()=>expect(complete).toBeTypeOf("function"));
    api.logout();
    complete(response({Id:USER,Name:"Alex"}));
    await expect(pending).rejects.toThrow("LOGIN_CANCELLED");
    expect(api.savedCredential()).toBeNull();
  });
});
