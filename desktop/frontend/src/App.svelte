<script lang="ts">
  import type {LibrarySnapshot,MediaItem,SessionPublic,ViewKey,Shelf,CatalogKind} from "./types";
  import {JellyfinApi} from "./api";
  import {ArtworkCache,hasArtwork,lazyArtwork} from "./artwork";
  import {buildShelves,featuredSlides} from "./discover";
  import MediaCard from "./MediaCard.svelte";
  import MediaDetails from "./MediaDetails.svelte";

  function deviceId():string{
    try{
      const key="vyneo.desktop.device";
      const old=localStorage.getItem(key);
      if(old && /^[a-z0-9-]{5,80}$/i.test(old))return old;
      const next="vyneo-"+crypto.randomUUID().replaceAll("-","");
      localStorage.setItem(key,next);
      return next;
    }catch{return "vyneo-desktop-local";}
  }
  const api=new JellyfinApi({deviceId:deviceId()});
  const artwork=new ArtworkCache(api);
  const empty=():LibrarySnapshot=>({
    recent:[],candidates:[],resume:[],nextUp:[],favorites:[],watched:[],collections:[]
  });
  type CatalogState={
    items:MediaItem[];nextOffset:number|null;total:number|null;
    loading:boolean;loaded:boolean;error:string;libraryAvailable:boolean|null;
  };
  const freshCatalog=():CatalogState=>({
    items:[],nextOffset:0,total:null,loading:false,loaded:false,
    error:"",libraryAvailable:null
  });
  let loginName=$state("");
  let loginPassword=$state("");
  let loginBusy=$state(false);
  let loginError=$state("");
  let session=$state<SessionPublic|null>(null);
  let data=$state<LibrarySnapshot>(empty());
  let catalogs=$state<Record<CatalogKind,CatalogState>>({
    Movie:freshCatalog(),Series:freshCatalog(),Anime:freshCatalog()
  });
  let favoriteCatalogs=$state<Record<CatalogKind,CatalogState>>({
    Movie:freshCatalog(),Series:freshCatalog(),Anime:freshCatalog()
  });
  const favoriteSections:Array<{kind:CatalogKind;label:string}>=[
    {kind:"Anime",label:"Animés"},
    {kind:"Movie",label:"Films"},
    {kind:"Series",label:"Séries"}
  ];
  let tab=$state<ViewKey>("home");
  let selected=$state<MediaItem|null>(null);
  let searchText=$state("");
  let searchRows=$state<MediaItem[]>([]);
  let searchBusy=$state(false);
  let homeWarning=$state("");
  let epoch=0;
  let refreshVersion=0;
  let searchTimer:ReturnType<typeof setTimeout>|null=null;
  const tabs:Array<{key:ViewKey;label:string}>= [
    {key:"home",label:"Accueil"},
    {key:"movies",label:"Films"},
    {key:"series",label:"Séries"},
    {key:"anime",label:"Animés"},
    {key:"favorites",label:"Ma liste"},
    {key:"universes",label:"Univers"}
  ];
  let catalogKind=$derived<CatalogKind|null>(
    tab==="movies"?"Movie":tab==="series"?"Series":tab==="anime"?"Anime":null);
  let heroIndex=$state(0);
  let shelves=$derived(session?buildShelves(data,session.userId):[]);
  let heroSlides=$derived(featuredSlides(shelves));
  let hero=$derived(heroSlides[heroIndex%Math.max(1,heroSlides.length)]??null);
  let gridItems=$derived.by(()=>{
    if(tab==="movies")return catalogs.Movie.items;
    if(tab==="series")return catalogs.Series.items;
    if(tab==="anime")return catalogs.Anime.items;
    if(tab==="universes")return data.collections;
    return [];
  });
  let searchActive=$derived(searchText.trim().length>=2);

  function catalogEntry(kind:CatalogKind,onlyFavorites=false):CatalogState{
    return onlyFavorites?favoriteCatalogs[kind]:catalogs[kind];
  }
  function setCatalogEntry(kind:CatalogKind,value:CatalogState,onlyFavorites=false){
    if(onlyFavorites)favoriteCatalogs={...favoriteCatalogs,[kind]:value};
    else catalogs={...catalogs,[kind]:value};
  }
  async function loadCatalog(kind:CatalogKind,onlyFavorites=false){
    if(!session)return;
    const user=session.userId,generation=epoch;
    const previous=catalogEntry(kind,onlyFavorites),offset=previous.nextOffset;
    if(previous.loading || offset===null)return;
    setCatalogEntry(kind,{...previous,loading:true,error:""},onlyFavorites);
    try{
      const page=onlyFavorites
        ?await api.getFavoritePage(kind,offset)
        :await api.getCatalogPage(kind,offset);
      if(generation!==epoch || session?.userId!==user)return;
      const before=catalogEntry(kind,onlyFavorites);
      const seen=new Set(before.items.map(item=>item.id));
      const fresh=page.items.filter(item=>{
        if(seen.has(item.id))return false;
        seen.add(item.id);return true;
      });
      setCatalogEntry(kind,{
        items:[...before.items,...fresh],nextOffset:page.nextOffset,
        total:page.total,libraryAvailable:page.libraryAvailable,
        loading:false,loaded:true,error:""
      },onlyFavorites);
    }catch{
      if(generation!==epoch || session?.userId!==user)return;
      setCatalogEntry(kind,{...catalogEntry(kind,onlyFavorites),
        loading:false,error:"Impossible de charger cette page. Réessayez."},
        onlyFavorites);
    }
  }
  function moveHero(step:number){
    if(heroSlides.length>1)
      heroIndex=(heroIndex+step+heroSlides.length)%heroSlides.length;
  }
  function selectTab(next:ViewKey){
    tab=next;selected=null;searchText="";searchRows=[];
    if(next==="movies" && !catalogs.Movie.loaded)void loadCatalog("Movie");
    if(next==="series" && !catalogs.Series.loaded)void loadCatalog("Series");
    if(next==="anime" && !catalogs.Anime.loaded)void loadCatalog("Anime");
    if(next==="favorites")for(const entry of favoriteSections){
      if(!favoriteCatalogs[entry.kind].loaded)void loadCatalog(entry.kind,true);
    }
    // Save only navigation preference. Never persist JWT or user content.
    if(session){
      try{localStorage.setItem("vyneo.tab."+session.userId,next);}catch{}
    }
    window.scrollTo({top:0,behavior:"instant"});
  }
  async function login(event:SubmitEvent){
    event.preventDefault();
    if(loginBusy)return;
    loginBusy=true;loginError="";
    const password=loginPassword;
    loginPassword="";
    try{
      const authenticated=await api.login(loginName,password);
      session=authenticated;
      const generation=++epoch;
      try{
        const stored=localStorage.getItem("vyneo.tab."+authenticated.userId);
        if(tabs.some(t=>t.key===stored))tab=stored as ViewKey;
      }catch{}
      void refresh(generation);
      if(tab==="movies")void loadCatalog("Movie");
      if(tab==="series")void loadCatalog("Series");
      if(tab==="anime")void loadCatalog("Anime");
      if(tab==="favorites")for(const entry of favoriteSections){
        void loadCatalog(entry.kind,true);
      }
    }catch{
      loginError="Connexion impossible. Vérifiez vos identifiants et le serveur.";
    }finally{
      loginBusy=false;
    }
  }
  async function refresh(generation=epoch){
    const version=++refreshVersion;
    homeWarning="";
    // Fetch the foreground shelves before the optional recommendations.
    const fast=await Promise.allSettled([api.getRecent(),api.getResume()]);
    if(generation!==epoch || version!==refreshVersion || !api.session)return;
    const recent=fast[0].status==="fulfilled"?fast[0].value:[];
    const resume=fast[1].status==="fulfilled"?fast[1].value:[];
    if(fast.every(r=>r.status==="rejected")){
      homeWarning="Serveur indisponible. Vos données resteront privées.";
      return;
    }
    data={...data,recent,resume};
    // Enrich the home in the background. A late result can never migrate
    // media from the previous account after logout or a session change.
    const add=await Promise.allSettled([
      api.getNextUp(),api.getFavorites(),api.getWatched(),
      api.getCollections()
    ]);
    if(generation!==epoch || version!==refreshVersion || !api.session)return;
    const names=["nextUp","favorites","watched","collections"] as const;
    for(const [index,name] of names.entries()){
      const result=add[index];
      if(result.status==="fulfilled")data={...data,[name]:result.value};
    }
    // Optional, lower-priority discovery feed. The first home render and
    // its shelves never wait on this larger user-authorized query.
    void api.getCandidates().then(items=>{
      if(generation!==epoch || version!==refreshVersion ||
         !api.session || session?.userId!==api.session.userId)return;
      data={...data,candidates:items};
    }).catch(()=>{
      // Keep existing shelves on timeout, denial or offline network.
    });
  }
  function logout(){
    epoch++;refreshVersion++;
    if(searchTimer!==null)clearTimeout(searchTimer);
    api.logout();artwork.clear();
    session=null;selected=null;tab="home";heroIndex=0;
    loginPassword="";loginName="";loginError="";
    searchText="";searchRows=[];searchBusy=false;data=empty();homeWarning="";
    catalogs={Movie:freshCatalog(),Series:freshCatalog(),Anime:freshCatalog()};
    favoriteCatalogs={Movie:freshCatalog(),Series:freshCatalog(),Anime:freshCatalog()};
  }
  function updateSearch(){
    if(searchTimer!==null)clearTimeout(searchTimer);
    const query=searchText.trim();
    if(query.length<2){searchRows=[];searchBusy=false;return;}
    const generation=epoch;
    searchTimer=setTimeout(async()=>{
      searchBusy=true;
      try{
        const rows=await api.search(query);
        if(generation===epoch && searchText.trim()===query)
          searchRows=rows;
      }catch{
        if(generation===epoch)searchRows=[];
      }finally{if(generation===epoch)searchBusy=false;}
    },260);
  }
  const titleFor=(page:ViewKey)=>
    tabs.find(t=>t.key===page)?.label??"Bibliothèque";
</script>

<svelte:head>
  <title>Vynéo</title>
  <meta name="theme-color" content="#0a0c11" />
</svelte:head>
<div class="vy-app" class:vy-authenticated={!!session}>
  {#if !session}
    <header class="vy-login-header">
      <strong class="vy-logo">Vynéo</strong>
      <span class="vy-brand-desc">VOTRE CINÉMA</span>
    </header>
    <main class="vy-login-main">
      <section class="vy-login-intro" aria-label="Bienvenue sur Vynéo">
        <span class="vy-eyebrow">UNE EXPÉRIENCE À PART</span>
        <h1>Vos films.<br />Votre univers.</h1>
        <p>Une interface conçue pour votre bibliothèque multimédia.
          Les films, séries et recommandations viennent de votre compte Jellyfin.</p>
        <span class="vy-origin-label">Connexion sécurisée à votre serveur</span>
      </section>
      <form class="vy-login-card" onsubmit={login}>
        <h2>Bienvenue sur Vynéo</h2>
        <p>Connectez-vous avec votre compte Jellyfin.</p>
        <label for="vy-username">Utilisateur</label>
        <input id="vy-username" type="text" autocomplete="username"
          bind:value={loginName} maxlength="96" required />
        <label for="vy-password">Mot de passe</label>
        <input id="vy-password" type="password"
          autocomplete="current-password" bind:value={loginPassword}
          maxlength="256" required />
        {#if loginError}<p class="vy-auth-error" role="alert">{loginError}</p>{/if}
        <button type="submit" class="vy-primary" disabled={loginBusy}>
          {loginBusy?"Connexion…":"Se connecter"}
        </button>
        <span class="vy-auth-hint">Les identifiants ne sont pas enregistrés par Vynéo.</span>
      </form>
    </main>
  {:else}
    <header class="vy-header">
      <button type="button" class="vy-logo vy-logo-button"
        aria-label="Retour à l'accueil" onclick={()=>selectTab("home")}>Vynéo</button>
      <nav class="vy-nav" aria-label="Navigation principale">
        {#each tabs as entry (entry.key)}
          <button type="button" class:active={tab===entry.key}
            aria-current={tab===entry.key?"page":undefined}
            onclick={()=>selectTab(entry.key)}>{entry.label}</button>
        {/each}
      </nav>
      <div class="vy-toolbar">
        <label class="vy-search-label">
          <span class="vy-search-icon" aria-hidden="true">⌕</span>
          <input type="search" aria-label="Rechercher dans ma bibliothèque"
            placeholder="Rechercher…" bind:value={searchText}
            oninput={updateSearch} />
        </label>
        <button type="button" class="vy-account" title="Se déconnecter"
          onclick={logout}>{session.username.slice(0,1).toUpperCase()}</button>
      </div>
    </header>
    <main class="vy-content">
      {#if searchActive}
        <section class="vy-browser">
          <div class="vy-browser-heading">
            <h1>Résultats pour « {searchText.trim()} »</h1>
            {#if searchBusy}<small>Recherche en cours</small>{/if}
          </div>
          <div class="vy-catalog-grid">
            {#each searchRows as item (item.id)}
              <MediaCard {item} cache={artwork}
                onclick={(next)=>selected=next} />
            {/each}
          </div>
          {#if !searchBusy && !searchRows.length}
            <p class="vy-empty">Aucun résultat dans votre bibliothèque.</p>
          {/if}
        </section>
      {:else if tab==="home"}
        <section class="vy-hero" aria-label="À la une">
          {#if hero && hasArtwork(hero)}
            <img class="vy-hero-art" alt=""
              use:lazyArtwork={{cache:artwork,item:hero,kind:"Backdrop" as const}} />
          {/if}
          <div class="vy-hero-shade"></div>
          <div class="vy-hero-inner">
            {#if hero}
              <span class="vy-kicker">VOTRE SÉLECTION</span>
              <h1>{hero.title}</h1>
              <p class="vy-hero-overview">{hero.overview ||
                [hero.year,...hero.genres.slice(0,3)].filter(Boolean).join(" · ")}</p>
              <div class="vy-hero-actions">
                <button type="button" class="vy-watch-button"
                  onclick={()=>selected=hero}>
                  <span aria-hidden="true">▶</span> Voir la fiche
                </button>
                <button type="button" class="vy-more-button"
                  onclick={()=>selectTab(hero.type==="Series"?"series":"movies")}>
                  {hero.type==="Series"?"Explorer les séries":"Explorer les films"}
                </button>
              </div>
            {:else}
              <span class="vy-kicker">VYNÉO DESKTOP</span>
              <h1>Votre univers, réinventé.</h1>
              <p class="vy-hero-overview">
                Votre bibliothèque prend vie dans une interface Vynéo
                indépendante et pensée pour la fluidité.
              </p>
              <button type="button" class="vy-watch-button"
                onclick={()=>void refresh()}>Actualiser ma bibliothèque</button>
            {/if}
          </div>
          {#if heroSlides.length>1}
            <div class="vy-hero-controls" aria-label="Choisir une affiche à la une">
              <button type="button" class="vy-hero-arrow"
                aria-label="Bannière précédente" onclick={()=>moveHero(-1)}>
                ‹
              </button>
              <div class="vy-hero-dots" role="group" aria-label="Bannières à la une">
                {#each heroSlides as slide,index (slide.id)}
                  <button type="button" class:active={hero?.id===slide.id}
                    aria-label={"Bannière "+(index+1)+" : "+slide.title}
                    aria-current={hero?.id===slide.id?"true":undefined}
                    onclick={()=>heroIndex=index}><span></span></button>
                {/each}
              </div>
              <button type="button" class="vy-hero-arrow"
                aria-label="Bannière suivante" onclick={()=>moveHero(1)}>
                ›
              </button>
            </div>
          {/if}
        </section>
        <div class="vy-shelves">
          {#each shelves as shelf (shelf.id)}
            <section class="vy-shelf" aria-label={shelf.title}>
              <div class="vy-shelf-heading">
                <h2>{shelf.title}</h2>
                <span class="vy-shelf-count">{shelf.items.length} titres</span>
              </div>
              <div class="vy-rail">
                {#each shelf.items as item,index (item.id)}
                  <MediaCard {item} cache={artwork}
                    rank={shelf.kind==="top10"?index+1:0}
                    variant={shelf.kind??"standard"}
                    reason={shelf.reasons?.[item.id]??""}
                    onclick={(next)=>selected=next} />
                {/each}
              </div>
            </section>
          {/each}
        </div>
        {#if homeWarning}<p class="vy-empty" role="status">{homeWarning}</p>{/if}
        <footer class="vy-footer">
          <span>Vynéo · Votre bibliothèque, notre interface</span>
          <button type="button" onclick={()=>void refresh()}>Actualiser</button>
        </footer>
      {:else if tab==="favorites"}
        <section class="vy-browser vy-favorites">
          <div class="vy-browser-heading">
            <div>
              <span class="vy-kicker">VOTRE SÉLECTION PERSONNELLE</span>
              <h1>Ma liste</h1>
            </div>
          </div>
          {#each favoriteSections as entry (entry.kind)}
            {@const group=favoriteCatalogs[entry.kind]}
            <section class="vy-shelf vy-favorites-shelf" aria-label={entry.label}>
              <div class="vy-shelf-heading">
                <h2>{entry.label}</h2>
                {#if group.total!==null}
                  <span class="vy-shelf-count">
                    {group.items.length} / {group.total} titres
                  </span>
                {/if}
              </div>
              {#if group.items.length}
                <div class="vy-rail">
                  {#each group.items as item (item.id)}
                    <MediaCard {item} cache={artwork}
                      onclick={(next)=>selected=next} />
                  {/each}
                </div>
              {:else if group.loading}
                <p class="vy-empty">Chargement de votre liste…</p>
              {:else if group.libraryAvailable===false}
                <p class="vy-empty">Bibliothèque non accessible à votre compte.</p>
              {:else if group.loaded && !group.error}
                <p class="vy-empty">Aucun favori dans cette bibliothèque.</p>
              {/if}
              {#if group.error}
                <p class="vy-empty" role="alert">{group.error}</p>
              {/if}
              {#if group.nextOffset!==null && group.libraryAvailable!==false}
                <div class="vy-pagination">
                  <button type="button" disabled={group.loading}
                    onclick={()=>void loadCatalog(entry.kind,true)}>
                    {group.loading?"Chargement…":
                      group.error?"Réessayer":"Afficher davantage"}
                  </button>
                </div>
              {/if}
            </section>
          {/each}
        </section>
      {:else}
        <section class="vy-browser">
          <div class="vy-browser-heading">
            <div>
              <span class="vy-kicker">VOTRE BIBLIOTHÈQUE</span>
              <h1>{titleFor(tab)}</h1>
            </div>
            <span class="vy-shelf-count">
              {gridItems.length}{#if catalogKind && catalogs[catalogKind].total!==null}
                / {catalogs[catalogKind].total}
              {/if} titres affichés
            </span>
          </div>
          <div class="vy-catalog-grid">
            {#each gridItems as item (item.id)}
              <MediaCard {item} cache={artwork}
                variant={tab==="universes"?"universe":"standard"}
                onclick={(next)=>selected=next} />
            {/each}
          </div>
          {#if catalogKind}
            {#if catalogs[catalogKind].error}
              <p class="vy-empty" role="alert">{catalogs[catalogKind].error}</p>
            {/if}
            {#if catalogs[catalogKind].nextOffset!==null}
              <div class="vy-pagination">
                <button type="button"
                  disabled={catalogs[catalogKind].loading}
                  onclick={()=>void loadCatalog(catalogKind!)}>
                  {catalogs[catalogKind].loading?"Chargement…":
                    catalogs[catalogKind].error?"Réessayer":"Afficher davantage"}
                </button>
              </div>
            {/if}
          {/if}
          {#if catalogKind && catalogs[catalogKind].libraryAvailable===false}
            <p class="vy-empty" role="status">
              La bibliothèque {titleFor(tab)} n'est pas accessible à ce compte Jellyfin.
            </p>
          {:else if !gridItems.length && (!catalogKind ||
            (!catalogs[catalogKind].loading && !catalogs[catalogKind].error))}
            <p class="vy-empty">Aucun titre disponible dans cette sélection.</p>
          {/if}
        </section>
      {/if}
    </main>
    {#if selected}
      <MediaDetails item={selected} {api} cache={artwork}
        onclose={()=>selected=null}/>
    {/if}
  {/if}
</div>
