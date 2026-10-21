import {describe,it,expect} from "vitest";
import type {MediaItem} from "../src/types";
import {planMediaMutation,projectMediaMutation} from "../src/media-actions";

const id=(n:number)=>n.toString(16).padStart(32,"0");
const make=(n:number,type:MediaItem["type"],seriesId?:string):MediaItem=>({
  id:id(n),type,title:"Titre "+n,year:2026,overview:"",
  genres:[],communityRating:null,isFavorite:false,played:false,
  progress:22,premiereDate:"",hasPrimary:false,hasBackdrop:false,
  seriesName:"",seriesId
});
describe("parent-safe media actions",()=>{
  it("favorites a series instead of an episode",()=>{
    const ep=make(1,"Episode",id(2));
    expect(planMediaMutation(ep,"favorite")).toEqual({
      targetId:id(2),enabled:true
    });
    expect(planMediaMutation({...ep,seriesId:null},"favorite")).toBeNull();
  });
  it("updates a parent and all its episodes, never unrelated series",()=>{
    const parent=make(2,"Series"),a=make(1,"Episode",id(2));
    const b=make(3,"Episode",id(2)),unrelated=make(4,"Episode",id(5));
    const mutation=planMediaMutation(a,"favorite")!;
    expect(projectMediaMutation(parent,a,mutation,"favorite").isFavorite)
      .toBe(true);
    expect(projectMediaMutation(b,a,mutation,"favorite").isFavorite)
      .toBe(true);
    expect(projectMediaMutation(unrelated,a,mutation,"favorite")).toBe(unrelated);
  });
  it("only marks the chosen episode seen and resets progress",()=>{
    const episode=make(1,"Episode",id(2));
    const other=make(3,"Episode",id(2));
    const mutation=planMediaMutation(episode,"played")!;
    expect(mutation).toEqual({targetId:episode.id,enabled:true});
    const updated=projectMediaMutation(episode,episode,mutation,"played");
    expect([updated.played,updated.progress]).toEqual([true,null]);
    expect(projectMediaMutation(other,episode,mutation,"played")).toBe(other);
  });
  it("allows toggling parent favorites and clearing watched state",()=>{
    const item={...make(1,"Movie"),isFavorite:true,played:true};
    const favorite=planMediaMutation(item,"favorite")!;
    const played=planMediaMutation(item,"played")!;
    expect(favorite.enabled).toBe(false);
    expect(played.enabled).toBe(false);
    expect(projectMediaMutation(item,item,played,"played").progress).toBe(22);
  });
});
