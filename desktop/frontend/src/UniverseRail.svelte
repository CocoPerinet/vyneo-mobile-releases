<script lang="ts">
  import {onMount} from "svelte";
  import {UNIVERSES} from "./universes";
  import type {UniverseId} from "./universes";
  import VyIcon from "./VyIcon.svelte";
  let {onselect}:{onselect:(id:UniverseId)=>void}=$props();
  let rail:HTMLDivElement;
  let left=$state(false),right=$state(true);
  const measure=()=>{
    if(!rail)return;
    left=rail.scrollLeft>5;
    right=rail.scrollLeft+rail.clientWidth<rail.scrollWidth-6;
  };
  const move=(dir:-1|1)=>rail?.scrollBy({
    left:dir*Math.max(250,rail.clientWidth*.75),behavior:"smooth"
  });
  onMount(()=>{
    const o=new ResizeObserver(measure);
    o.observe(rail);
    const t=setTimeout(measure,30);
    return()=>{o.disconnect();clearTimeout(t);}
  });
</script>
<section class="vy-shelf vy-universe-section" aria-label="Univers">
  <div class="vy-shelf-heading"><h2>Univers</h2></div>
  <div class="vy-rail-frame">
    {#if left}
      <button class="vy-rail-arrow vy-rail-arrow-left" type="button"
        aria-label="Défiler Univers vers la gauche" onclick={()=>move(-1)}>
        <VyIcon kind="chevron-left" size={25}/>
      </button>
    {/if}
    <div class="vy-rail vy-universe-rail" bind:this={rail} onscroll={measure}>
      {#each UNIVERSES as universe (universe.id)}
        <button class="vy-universe-tile" type="button"
          data-vy-universe={universe.id}
          aria-label={"Explorer l'univers "+universe.label}
          onclick={()=>onselect(universe.id)}>
          <img src={universe.logo} alt={universe.label} loading="lazy"/>
        </button>
      {/each}
    </div>
    {#if right}
      <button class="vy-rail-arrow vy-rail-arrow-right" type="button"
        aria-label="Défiler Univers vers la droite" onclick={()=>move(1)}>
        <VyIcon kind="chevron-right" size={25}/>
      </button>
    {/if}
  </div>
</section>
