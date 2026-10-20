import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";

const css=readFileSync(new URL("../src/styles.css",import.meta.url),"utf8");
const rule=(selector:string)=>{
  const start=css.indexOf(selector+"{");
  if(start<0)return "";
  const end=css.indexOf("}",start);
  return end>=0?css.slice(start+selector.length+1,end):"";
};

describe("desktop scroll and navigation layout contract",()=>{
  it("keeps the navigation sticky rather than captured by the page root",()=>{
    // overflow-x:hidden silently computes overflow-y:auto and traps sticky.
    const root=rule(".vy-app");
    expect(root).toMatch(/overflow-x\s*:\s*clip\s*;/);
    expect(root).not.toMatch(/overflow-x\s*:\s*hidden/);
    expect(root).not.toMatch(/overflow-y\s*:\s*(auto|scroll|hidden)/);
    const header=rule(".vy-header");
    expect(header).toMatch(/position\s*:\s*sticky\s*;/);
    expect(header).toMatch(/top\s*:\s*0\s*;/);
  });
});
