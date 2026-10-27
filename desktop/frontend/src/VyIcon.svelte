<script lang="ts">
  type Kind="search"|"chevron-left"|"chevron-right"|"heart"|"check"|
    "info"|"play"|"download"|"x"|"volume"|"users"|"folder"|"list";
  let {kind,size=20}:{
    kind:Kind;size?:number
  }=$props();
  const paths:Record<Kind,string>={
    search:"m21 21-4.35-4.35 M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    "chevron-left":"m15 18-6-6 6-6",
    "chevron-right":"m9 18 6-6-6-6",
    heart:"M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z",
    check:"M20 6 9 17l-5-5",
    info:"M12 16v-4 M12 8h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    play:"M8 5v14l11-7z",
    download:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
    x:"M18 6 6 18 M6 6l12 12",
    volume:"M11 5 6 9H2v6h4l5 4V5z M15.54 8.46a5 5 0 0 1 0 7.07",
    users:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
    folder:"M3 7V5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    list:"M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01"
  };
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.9" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true" focusable="false"
  class="vy-svg-icon">
  <path d={paths[kind]} />
</svg>
