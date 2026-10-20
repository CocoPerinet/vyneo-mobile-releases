<script lang="ts">
  import type {MediaItem} from "./types";
  import type {ArtworkCache} from "./artwork";
  import {hasArtwork,lazyArtwork} from "./artwork";
  import VyIcon from "./VyIcon.svelte";
  type Props={
    item:MediaItem;cache:ArtworkCache;
    x:number;y:number;source:string;novelty:string|null;
    busy?:boolean;parentLoading?:boolean;error?:string;
    onopen:()=>void;onfavorite:()=>void;onplayed:()=>void;
    onhide:()=>void;onenter:()=>void;onleave:()=>void;
  };
  let {item,cache,x,y,source,novelty,busy=false,
    parentLoading=false,error="",
    onopen,onfavorite,onplayed,onhide,onenter,onleave}:Props=$props();
  const duration=(ticks:number|null|undefined):string=>{
    if(!ticks)return "";
    const min=Math.round(ticks/600000000);
    return min>=60?Math.floor(min/60)+" h "+String(min%60).padStart(2,"0"):
      min+" min";
  };
</script>
<div class="vy-hover-popup" role="dialog" tabindex="-1" aria-label={"Aperçu : "+item.title}
  style:left={x+"px"} style:top={y+"px"}
  onpointerenter={onenter} onpointerleave={onleave}
  data-vy-popup="true">
  <button class="vy-hover-image" type="button" onclick={onopen}
    aria-label={"Voir la fiche de "+item.title}>
    {#if hasArtwork(item)}
      <img alt="" use:lazyArtwork={{cache,item,kind:"Backdrop" as const}}/>
    {/if}
    {#if novelty}
      <span class="vy-novelty">{novelty}</span>
    {/if}
    {#if item.progress!==null && item.progress>0}
      <span class="vy-card-progress" aria-hidden="true">
        <span style:width={item.progress+"%"}></span>
      </span>
    {/if}
  </button>
  <div class="vy-hover-content">
    <div class="vy-hover-actions">
      <button type="button" class="vy-icon-button vy-icon-primary"
        aria-label="Afficher les options de lecture" title="Afficher la fiche et les options de lecture"
        onclick={onopen}><VyIcon kind="play" size={20}/></button>
      <button type="button" class="vy-icon-button" class:active={item.isFavorite}
        aria-label={parentLoading?"Vérification du favori de la série":
          item.isFavorite?"Retirer de ma liste":"Ajouter à ma liste"}
        title={parentLoading?"Synchronisation du favori…":"Ma liste"}
        disabled={busy||parentLoading} onclick={onfavorite}>
        <VyIcon kind="heart" size={18}/>
      </button>
      <button type="button" class="vy-icon-button" class:active={item.played}
        aria-label={item.played?"Marquer non vu":"Marquer vu"} title="Vu / non vu"
        disabled={busy} onclick={onplayed}><VyIcon kind="check" size={18}/></button>
      <button type="button" class="vy-icon-button" aria-label="Informations"
        title="Voir la fiche" onclick={onopen}><VyIcon kind="info" size={18}/></button>
      <button type="button" class="vy-icon-button" disabled
        aria-label="Téléchargement bientôt disponible"
        title="Téléchargement natif non disponible"><VyIcon kind="download" size={17}/></button>
      {#if source==="next-up" || source==="resume"}
        <button type="button" class="vy-icon-button"
          aria-label="Masquer de ce rayon sur cet appareil"
          title="Masquer de ce rayon dans Vynéo Desktop"
          onclick={onhide}><VyIcon kind="x" size={17}/></button>
      {/if}
    </div>
    <strong class="vy-hover-title">{item.seriesName||item.title}
      {#if item.seriesName}<span> · {item.title}</span>{/if}
    </strong>
    <div class="vy-hover-meta">
      {#if item.year}<span>{item.year}</span>{/if}
      {#if duration(item.runtimeTicks)}<span>{duration(item.runtimeTicks)}</span>{/if}
      {#if item.communityRating!==null}
        <span class="vy-hover-score">★ {item.communityRating.toFixed(1)}</span>
      {/if}
    </div>
    {#if item.genres.length}
      <div class="vy-hover-genres">
        {#each item.genres.slice(0,3) as genre}
          <span>{genre}</span>
        {/each}
      </div>
    {/if}
    <p class="vy-hover-summary">{item.overview||"Aucun synopsis disponible."}</p>
    {#if error}<p class="vy-hover-error" role="status">{error}</p>{/if}
  </div>
</div>
