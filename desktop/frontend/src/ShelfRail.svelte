<script lang="ts">
  import {onMount} from "svelte";
  import type {MediaItem,Shelf} from "./types";
  import type {ArtworkCache} from "./artwork";
  import MediaCard from "./MediaCard.svelte";
  import VyIcon from "./VyIcon.svelte";
  type Props={
    shelf:Shelf;cache:ArtworkCache;
    onclick:(item:MediaItem)=>void;
    onhover?:(item:MediaItem,element:HTMLElement,source:string,
      trigger?:"pointer"|"keyboard")=>void;
    onleave?:()=>void;
    badge?:(item:MediaItem)=>string|null;
    showCount?:boolean;
  };
  let {shelf,cache,onclick,onhover,onleave,badge,
       showCount=false}:Props=$props();
  let rail:HTMLDivElement;
  let previous=$state(false),next=$state(false);
  function measure(){
    if(!rail)return;
    previous=rail.scrollLeft>4;
    next=rail.scrollLeft+rail.clientWidth<rail.scrollWidth-5;
  }
  function move(direction:-1|1){
    if(!rail)return;
    rail.scrollBy({left:direction*Math.max(280,rail.clientWidth*.76),
      behavior:"smooth"});
  }
  onMount(()=>{
    let frame=0;
    const schedule=()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(measure);
    };
    const observer=new ResizeObserver(schedule);
    const onKeyDown=(event:KeyboardEvent)=>{
      // Jellyfin's rails are navigable by keyboard. Move real DOM focus,
      // not only scroll position, so the target's title is announced.
      if((event.key!=="ArrowLeft" && event.key!=="ArrowRight") ||
        event.altKey || event.ctrlKey || event.metaKey ||
        !(event.target instanceof Element))return;
      const origin=event.target.closest(".vy-card");
      if(!origin || !rail.contains(origin))return;
      const buttons=[...rail.querySelectorAll<HTMLButtonElement>(
        ".vy-card .vy-card-main")];
      const current=buttons.findIndex(button=>origin.contains(button));
      const next=current+(event.key==="ArrowRight"?1:-1);
      if(current<0 || next<0 || next>=buttons.length)return;
      event.preventDefault();
      buttons[next].focus({preventScroll:true});
      buttons[next].scrollIntoView({
        behavior:"smooth",block:"nearest",inline:"nearest"
      });
    };
    rail.addEventListener("keydown",onKeyDown);
    const watchEdges=()=>{
      observer.disconnect();
      observer.observe(rail);
      if(rail.firstElementChild)observer.observe(rail.firstElementChild);
      if(rail.lastElementChild && rail.lastElementChild!==rail.firstElementChild)
        observer.observe(rail.lastElementChild);
      schedule();
    };
    const mutations=new MutationObserver(watchEdges);
    mutations.observe(rail,{childList:true});
    watchEdges();
    const t=setTimeout(measure,80);
    return()=>{
      clearTimeout(t);cancelAnimationFrame(frame);
      mutations.disconnect();observer.disconnect();
      rail.removeEventListener("keydown",onKeyDown);
    };
  });
</script>
<section class="vy-shelf" aria-label={shelf.title} data-vy-section={shelf.id}>
  <div class="vy-shelf-heading">
    <h2>{shelf.title}</h2>
    {#if showCount}
      <span class="vy-shelf-count">{shelf.items.length} titres</span>
    {/if}
  </div>
  <div class="vy-rail-frame">
    {#if previous}
      <button type="button" class="vy-rail-arrow vy-rail-arrow-left"
        aria-label={"Défiler "+shelf.title+" vers la gauche"}
        onclick={()=>move(-1)}><VyIcon kind="chevron-left" size={25}/></button>
    {/if}
    <div bind:this={rail} class="vy-rail" onscroll={measure}>
      {#each shelf.items as item,index (item.id)}
        <MediaCard {item} {cache} {onclick}
          rank={shelf.kind==="top10"?index+1:0}
          variant={shelf.kind??"standard"}
          reason={shelf.reasons?.[item.id]??""}
          novelty={badge?.(item)??null}
          onhover={(element,trigger)=>onhover?.(item,element,shelf.id,trigger)}
          onleave={onleave??(()=>{})} />
      {/each}
    </div>
    {#if next}
      <button type="button" class="vy-rail-arrow vy-rail-arrow-right"
        aria-label={"Défiler "+shelf.title+" vers la droite"}
        onclick={()=>move(1)}><VyIcon kind="chevron-right" size={25}/></button>
    {/if}
  </div>
</section>