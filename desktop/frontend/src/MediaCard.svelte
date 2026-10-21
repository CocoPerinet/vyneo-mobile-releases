<script lang="ts">
  import type {MediaItem} from "./types";
  import type {ArtworkCache} from "./artwork";
  import {hasArtwork,lazyArtwork} from "./artwork";
  import VyIcon from "./VyIcon.svelte";
  type Props={
    item:MediaItem;
    cache:ArtworkCache;
    onclick:(item:MediaItem)=>void;
    rank?:number;
    variant?:"standard"|"top10"|"universe";
    reason?:string;
    novelty?:string|null;
    actionLabel?:string;
    onhover?:(element:HTMLElement,trigger?:"pointer"|"keyboard")=>void;
    onleave?:()=>void;
  };
  let {item,cache,onclick,rank=0,variant="standard",
    reason="",novelty=null,actionLabel="",onhover,onleave}:Props=$props();
  const genreLabel=(item:MediaItem)=>item.genres.slice(0,2).join(" · ");
  const episodeLabel=(item:MediaItem)=>{
    if(item.type!=="Episode")return "";
    if(item.seasonNumber===null || item.seasonNumber===undefined ||
       item.episodeNumber===null || item.episodeNumber===undefined)return "";
    return "S"+String(item.seasonNumber).padStart(2,"0")+
      "E"+String(item.episodeNumber).padStart(2,"0")+" · ";
  };
</script>

<article class="vy-card"
  class:vy-card-ranking={variant==="top10"}
  class:vy-card-universe={variant==="universe"}
  onpointerenter={(event)=>{
    if(event.pointerType==="mouse" && onhover)
      onhover(event.currentTarget);
  }}
  onpointerleave={()=>onleave?.()}
  data-vy-card={item.id}>
  <button type="button" class="vy-card-main"
    onclick={()=>onclick(item)}
    aria-label={actionLabel||"Détails : "+item.title}
    aria-haspopup={onhover?"dialog":undefined}
    aria-keyshortcuts={onhover?"ArrowDown":undefined}
    onkeydown={(event)=>{
      if(event.key!=="ArrowDown" || event.repeat || !onhover)return;
      event.preventDefault();
      const card=event.currentTarget.closest(".vy-card");
      if(card instanceof HTMLElement)onhover(card,"keyboard");
    }}>
    <span class="vy-card-picture">
      {#if rank>0}
        <span class="vy-rank" aria-hidden="true">{rank}</span>
      {/if}
      {#if item.type==="BoxSet" || item.type==="Playlist"}
        <span class="vy-group-placeholder" aria-hidden="true">
          <VyIcon kind={item.type==="BoxSet"?"folder":"list"} size={44}/>
          <span>{item.type==="BoxSet"?"COLLECTION":"PLAYLIST"}</span>
        </span>
      {/if}
      {#if hasArtwork(item)}
        <img alt="" decoding="async" loading="lazy"
          use:lazyArtwork={{cache,item,kind:"Backdrop" as const}} />
      {/if}
      <span class="vy-card-shade" aria-hidden="true"></span>
      {#if novelty}
        <span class="vy-novelty">{novelty}</span>
      {/if}
      {#if item.progress!==null && item.progress>0}
        <span class="vy-card-progress" aria-hidden="true">
          <span style:width={item.progress+"%"}></span>
        </span>
      {/if}
    </span>
    <span class="vy-card-title">
      {item.type==="Episode" && item.seriesName?item.seriesName:item.title}
    </span>
    <span class="vy-card-caption">
      {#if item.type==="Episode"}{episodeLabel(item)}{item.title}
      {:else}
        {item.year??" "}
        {#if genreLabel(item)}
          <span aria-hidden="true"> · </span>{genreLabel(item)}
        {/if}
      {/if}
    </span>
    {#if reason}<span class="vy-card-reason">{reason}</span>{/if}
  </button>
</article>
