<script lang="ts">
  import type {MediaItem} from "./types";
  import type {ArtworkCache} from "./artwork";
  import {hasArtwork,lazyArtwork} from "./artwork";
  import VyIcon from "./VyIcon.svelte";
  type Props={
    item:MediaItem;cache:ArtworkCache;busy?:boolean;
    onopen:(item:MediaItem)=>void;
    onfavorite:(item:MediaItem)=>void;
    onplayed:(item:MediaItem)=>void;
  };
  let {item,cache,busy=false,onopen,onfavorite,onplayed}:Props=$props();
  const date=(item:MediaItem)=>{
    const value=Date.parse(item.premiereDate);
    return Number.isFinite(value)
      ?new Date(value).toLocaleDateString("fr-FR",{
        day:"numeric",month:"long",year:"numeric"})
      :String(item.year??"");
  };
  const duration=(ticks:number|null|undefined)=>{
    if(!ticks)return "";
    const minutes=Math.round(ticks/600000000);
    return minutes>=60?Math.floor(minutes/60)+" h "+
      String(minutes%60).padStart(2,"0"):""+minutes+" min";
  };
</script>

<article class="vy-universe-entry" data-vy-universe-item={item.id}>
  <button type="button" class="vy-universe-main"
    aria-label={"Voir la fiche de "+item.title} onclick={()=>onopen(item)}>
    <span class="vy-universe-thumb">
      {#if hasArtwork(item)}
        <img alt="" loading="lazy" decoding="async"
          use:lazyArtwork={{cache,item,kind:"Backdrop" as const}}/>
      {/if}
      <span class="vy-universe-play" aria-hidden="true">
        <VyIcon kind="play" size={19}/>
      </span>
      {#if item.played}
        <span class="vy-universe-watched" aria-label="Déjà vu">✓ Vu</span>
      {/if}
      {#if item.isFavorite}
        <span class="vy-universe-favmark" aria-label="Dans ma liste">♥</span>
      {/if}
    </span>
    <span class="vy-universe-info">
      <strong class="vy-universe-title">{item.title}</strong>
      <span class="vy-universe-meta">
        {#if date(item)}<span>{date(item)}</span>{/if}
        {#if item.type==="Series" && item.seasonCount}
          <span>{item.seasonCount} saison{item.seasonCount>1?"s":""}</span>
        {:else if item.type==="Movie" && duration(item.runtimeTicks)}
          <span>{duration(item.runtimeTicks)}</span>
        {/if}
        {#if item.communityRating!==null}
          <span class="vy-universe-rating">★ {item.communityRating.toFixed(1)}</span>
        {/if}
      </span>
      {#if item.overview}
        <span class="vy-universe-summary">{item.overview}</span>
      {/if}
    </span>
  </button>
  <div class="vy-universe-actions">
    <button type="button" class="vy-universe-action" class:vy-favorite={item.isFavorite}
      disabled={busy} title="Ma liste"
      aria-label={item.isFavorite?"Retirer de ma liste":"Ajouter à ma liste"}
      onclick={()=>onfavorite(item)}><VyIcon kind="heart" size={18}/></button>
    <button type="button" class="vy-universe-action" class:vy-played={item.played}
      disabled={busy} title="Vu / non vu"
      aria-label={item.played?"Marquer non vu":"Marquer vu"}
      onclick={()=>onplayed(item)}><VyIcon kind="check" size={18}/></button>
  </div>
</article>
