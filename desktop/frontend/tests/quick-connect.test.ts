import {describe,it,expect,vi} from "vitest";
import {JellyfinApi,SERVER_ORIGIN} from "../src/api";
const ID="a".repeat(32),TOKEN="b".repeat(64);
const SECRET="c".repeat(64),CODE="123456";
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{"Content-Type":"application/json"}
});
describe("ephemeral passwordless Jellyfin Quick Connect",()=>{
  it("returns only the human code and exchanges proof by POST after approval",async()=>{
    let approved=false;
    const calls:Array<{url:URL,request:RequestInit}>=[];
    const fetcher=vi.fn(async(input:RequestInfo|URL,
      request:RequestInit={})=>{
      const url=new URL(String(input));calls.push({url,request});
      if(url.pathname==="/QuickConnect/Initiate")
        return json({Secret:SECRET,Code:CODE,Authenticated:false});
      if(url.pathname==="/Users/AuthenticateWithQuickConnect")
        return approved?json({
          User:{Id:ID},AccessToken:TOKEN
        }):json({error:"pending"},401);
      if(url.pathname==="/Users/Me")
        return json({Id:ID,Name:"Alice",Policy:{IsDisabled:false}});
      throw new Error("Unexpected route");
    }) as typeof fetch;
    const api=new JellyfinApi({fetcher});
    expect(await api.beginQuickConnect()).toBe(CODE);
    expect(api.session).toBeNull();
    expect(api.savedCredential()).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].url.origin).toBe(SERVER_ORIGIN);
    expect(calls[0].url.search).toBe("");
    expect(calls[0].request.method).toBe("POST");
    expect(JSON.parse(String(calls[0].request.body))).toEqual({});
    await expect(api.completeQuickConnect())
      .rejects.toThrow("QUICK_CONNECT_NOT_AUTHORIZED");
    expect(api.savedCredential()).toBeNull();
    approved=true;
    expect(await api.completeQuickConnect()).toEqual({
      userId:ID,username:"Alice"
    });
    expect(api.savedCredential()).toEqual({
      userId:ID,username:"Alice",accessToken:TOKEN
    });
    const exchange=calls.find(c=>
      c.url.pathname==="/Users/AuthenticateWithQuickConnect" &&
      c.request.method==="POST");
    expect(exchange).toBeTruthy();
    expect(exchange!.url.search).toBe("");
    expect(JSON.parse(String(exchange!.request.body))).toEqual({
      Secret:SECRET
    });
    expect((exchange!.request.headers as Record<string,string>).Authorization)
      .not.toContain(SECRET);
    expect(calls.every(c=>!c.url.href.includes(SECRET) &&
      !c.url.href.includes(TOKEN) && c.request.credentials==="omit"))
      .toBe(true);
    expect(calls.some(c=>c.url.pathname==="/QuickConnect/Connect"))
      .toBe(false);
    await expect(api.completeQuickConnect())
      .rejects.toThrow("QUICK_CONNECT_NOT_STARTED");
    api.logout();
    expect(api.savedCredential()).toBeNull();
  });
  it("cancel revokes a delayed pairing request before it can return a code",async()=>{
    let resolve:(value:Response)=>void=()=>{};
    const fetcher=vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input));
      if(url.pathname==="/QuickConnect/Initiate")
        return new Promise<Response>(yes=>{resolve=yes;});
      throw new Error("Unexpected route");
    }) as typeof fetch;
    const api=new JellyfinApi({fetcher});
    const pending=api.beginQuickConnect();
    await vi.waitFor(()=>expect(resolve).not.toBeUndefined());
    api.cancelQuickConnect();
    resolve(json({Secret:SECRET,Code:CODE}));
    await expect(pending).rejects.toThrow("QUICK_CONNECT_CANCELLED");
    await expect(api.completeQuickConnect())
      .rejects.toThrow("QUICK_CONNECT_NOT_STARTED");
  });
  it("rejects malformed pairing and mismatched identity without logging in",async()=>{
    const badFetch=vi.fn(async()=>json({
      Secret:"bad\nsecret",Code:"123456"
    })) as typeof fetch;
    const bad=new JellyfinApi({fetcher:badFetch});
    await expect(bad.beginQuickConnect())
      .rejects.toThrow("QUICK_CONNECT_INVALID");
    expect(bad.session).toBeNull();

    const mismatched=vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input));
      if(url.pathname==="/QuickConnect/Initiate")
        return json({Secret:SECRET,Code:CODE});
      if(url.pathname==="/Users/AuthenticateWithQuickConnect")
        return json({User:{Id:ID},AccessToken:TOKEN});
      if(url.pathname==="/Users/Me")
        return json({Id:"d".repeat(32),Name:"Other"});
      throw new Error("Unexpected route");
    }) as typeof fetch;
    const api=new JellyfinApi({fetcher:mismatched});
    await api.beginQuickConnect();
    await expect(api.completeQuickConnect())
      .rejects.toThrow("QUICK_CONNECT_INVALID");
    expect(api.savedCredential()).toBeNull();
  });
});
