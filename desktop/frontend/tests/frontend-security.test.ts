import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";

const base=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=(file:string)=>readFileSync(resolve(base,file),"utf8");
describe("standalone native packaging contract",()=>{
  it("uses a packaged frontend without Jellyfin Web, iframe or inject.js",()=>{
    const config=JSON.parse(read("../src-tauri/tauri.conf.json"));
    const runtime=read("../src-tauri/src/main.rs");
    const html=read("index.html");
    expect(config.build.frontendDist).toBe("../frontend/dist");
    expect(runtime).toContain('WebviewUrl::App("index.html".into())');
    expect(runtime).not.toContain("WebviewUrl::External");
    expect(html).not.toContain("jellyfin-vyneo/web");
    expect(html).not.toContain("inject.js");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("connect-src 'self' https://cocojellyfin.duckdns.org:38443");
    expect(config.app.security.capabilities).toEqual([]);
  });
  it("does not persist access tokens or use token-bearing media URLs",()=>{
    const api=read("src/api.ts"),ui=read("src/App.svelte");
    expect(api).not.toContain('localStorage.setItem("token"');
    expect(api).not.toContain("api_key");
    expect(api).toContain('credentials:"omit"');
    expect(api).toContain('this.token=null');
    expect(ui).not.toContain("dangerouslySetInnerHTML");
    expect(ui).not.toContain("{@html");
  });
});
