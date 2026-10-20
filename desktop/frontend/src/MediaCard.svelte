<script lang="ts">
  import type {MediaItem} from "./types";
  import type {ArtworkCache} from "./artwork";
  import {hasArtwork,lazyArtwork} from "./artwork";
  type Props={
    item:MediaItem;
    cache:ArtworkCache;
    onclick:(item:MediaItem)=>void;
    rank?:number;
    variant?:"standard"|"top10"|"universe";
    reason?:string;
  };
  let {item,cache,onclick,rank=0,variant="standard",reason=""}:Props=$props();
  const genreLabel=(item:MediaItem)=>item.genres.slice(0,2).join(" · ");
</script>

<button type="button" class="vy-card"
  class:vy-card-ranking={variant==="top10"}
  class:vy-card-universe={variant==="universe"}
  onclick={()=>onclick(item)}
  aria-label={"Détails : "+item.title}
  title={item.title}>
  <span class="vy-card-picture">
    {#if rank>0}
      <span class="vy-rank" aria-hidden="true">{rank}</span>
    {/if}
    {#if hasArtwork(item)}
      <img alt="" decoding="async" loading="lazy"
        use:lazyArtwork={{cache,item,kind:"Backdrop" as const}} />
    {/if}
    <span class="vy-card-shade" aria-hidden="true"></span>
    {#if item.progress!==null && item.progress>0}
      <span class="vy-card-progress" aria-hidden="true">
        <span style:width={item.progress+"%"}></span>
      </span>
    {/if}
  </span>
  <span class="vy-card-title">{item.title}</span>
  <span class="vy-card-caption">
    {item.year??" "}
    {#if genreLabel(item)}
      <span aria-hidden="true"> · </span>{genreLabel(item)}
    {/if}
    {#if item.seriesName}<span> · {item.seriesName}</span>{/if}
  </span>
  {#if reason}<span class="vy-card-reason">{reason}</span>{/if}
</button>
