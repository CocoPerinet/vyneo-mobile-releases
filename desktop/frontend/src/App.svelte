<script lang="ts">
  import type {LibrarySnapshot,MediaItem,SessionPublic,ViewKey,Shelf,CatalogKind} from "./types";
  import {onMount} from "svelte";
  import {nativeVault} from "./credential-vault";
  import {JellyfinApi} from "./api";
  import {ArtworkCache,hasArtwork,lazyArtwork} from "./artwork";
  import {buildShelves,featuredSlides} from "./discover";
  import {g7zClient} from "./g7z-client";
  import {requestNativeG7y,mergeNativeG7y} from "./g7z-secure-shelves";
  import {requestNativePersonal,mergeNativePersonal} from "./g7z-personal";
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
  let vaultNotice=$state("");
  let rememberMe=$state(true);
  let credentialStored=$state(false);
  let restoreBusy=$state(true);
  let profileOpen=$state(false);
  let nativeBusy=$state(false);
  let nativeLinked=$state(false);
  let nativeCode=$state("");
  let nativeStatus=$state("");
  let nativePersonal=$state<Shelf|null>(null);
  let nativeG7yRows=$state<Shelf[]|null>(null);
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
  let shelves=$derived(session?mergeNativeG7y(
    mergeNativePersonal(buildShelves(data,session.userId),nativePersonal),
    nativeG7yRows):[]);
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
    tab=next;selected=null;searchText="";searchRows=[];profileOpen=false;
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
  function acceptSession(authenticated:SessionPublic){
    session=authenticated;profileOpen=false;
    nativeLinked=false;nativeBusy=false;nativeCode="";nativeStatus="";
    nativePersonal=null;nativeG7yRows=null;
    const generation=++epoch;
    try{
      const stored=localStorage.getItem("vyneo.tab."+authenticated.userId);
      if(tabs.some(t=>t.key===stored))tab=stored as ViewKey;
    }catch{}
    void refresh(generation);
    if(tab==="movies")void loadCatalog("Movie");
    if(tab==="series")void loadCatalog("Series");
    if(tab==="anime")void loadCatalog("Anime");
    if(tab==="favorites")for(const entry of favoriteSections)
      void loadCatalog(entry.kind,true);
  }
  async function restoreSaved(){
    try{
      const saved=await nativeVault.read();
      if(!saved)return;
      const authenticated=await api.restore(saved);
      acceptSession(authenticated);
      credentialStored=true;
    }catch(error){
      const code=error instanceof Error?error.message:String(error);
      if(["SESSION_EXPIRED","RESTORE_INVALID","VAULT_INVALID_SESSION"].includes(code))
        await nativeVault.clear().catch(()=>{});
      else if(nativeVault.available)
        vaultNotice="Connexion automatique indisponible. Reconnectez-vous si nécessaire.";
    }finally{restoreBusy=false;}
  }
  onMount(()=>{void restoreSaved();});
  async function login(event:SubmitEvent){
    event.preventDefault();
    if(loginBusy || restoreBusy)return;
    loginBusy=true;loginError="";vaultNotice="";credentialStored=false;
    const password=loginPassword;
    loginPassword="";
    try{
      const authenticated=await api.login(loginName,password);
      const credential=api.savedCredential();
      if(rememberMe && credential && nativeVault.available){
        try{await nativeVault.save(credential);credentialStored=true;}catch{
          vaultNotice="Connexion réussie, mais la mémorisation sécurisée est indisponible.";
        }
      }else if(nativeVault.available){
        await nativeVault.clear().catch(()=>{});
      }
      acceptSession(authenticated);
    }catch{
      loginError="Connexion impossible. Vérifiez vos identifiants et le serveur.";
    }finally{loginBusy=false;}
  }
  function nativeStamp(){
    return session?{userId:session.userId,epoch}:null;
  }
  function nativeAllowed():MediaItem[]{
    const pool=[...(data.candidates??[]),...data.recent,
      ...data.resume,...data.nextUp,...data.favorites,...data.watched,
      ...catalogs.Movie.items,...catalogs.Series.items];
    const seen=new Set<string>(),valid:MediaItem[]=[];
    for(const item of pool){
      const key=item.id.toLowerCase();
      if(seen.has(key))continue;
      seen.add(key);valid.push(item);
      if(valid.length===640)break;
    }
    return valid;
  }
  async function loadNative(generation=epoch,version=refreshVersion){
    if(!session || !g7zClient.available)return;
    const userId=session.userId;
    const stillValid=()=>generation===epoch &&
      version===refreshVersion && session?.userId===userId &&
      api.session?.userId===userId;
    const linked=await g7zClient.linked(userId);
    if(!stillValid())return;
    nativeLinked=linked;
    if(!linked || !(data.candidates?.length))return;
    const personal=await requestNativePersonal({
      current:nativeStamp,allowed:nativeAllowed,
      nativeTransport:(id)=>g7zClient.suggestions(id,"personal")
    });
    if(!stillValid())return;
    nativePersonal=personal;
    const rotating=await requestNativeG7y({
      current:nativeStamp,allowed:nativeAllowed,
      nativeTransport:(id)=>g7zClient.suggestions(id,"rotating")
    });
    if(!stillValid())return;
    nativeG7yRows=rotating;
    // Errors remain local to the optional recommendations module.
  }
  async function startNativeLink(){
    if(!session || nativeBusy || !g7zClient.available)return;
    const userId=session.userId,generation=epoch;
    nativeBusy=true;nativeStatus="Ouverture sécurisée de Cloudflare Access…";
    try{
      const result=await g7zClient.begin(userId);
      if(generation!==epoch || session?.userId!==userId)return;
      if(result.state==="ALREADY_LINKED"){
        nativeCode="";nativeLinked=true;
        nativeStatus="Compte déjà associé. Actualisation des suggestions…";
        void loadNative(generation);
      }else{
        nativeCode=result.userCode;
        nativeLinked=false;
        nativeStatus="Code valable cinq minutes. Autorisez cet appareil dans "+
          "le menu Profil de Vynéo Preview, puis revenez ici.";
      }
    }catch{
      if(generation===epoch){
        nativeStatus="Association indisponible. La connexion Jellyfin reste active.";
      }
    }finally{if(generation===epoch)nativeBusy=false;}
  }
  async function finishNativeLink(){
    if(!session || !nativeCode || nativeBusy)return;
    const generation=epoch,userId=session.userId;
    nativeBusy=true;nativeStatus="Vérification de l'autorisation…";
    try{
      await g7zClient.complete(userId);
      if(generation!==epoch || session?.userId!==userId)return;
      nativeCode="";nativeLinked=true;
      nativeStatus="Recommandations privées associées à votre compte.";
      void loadNative(generation);
    }catch{
      if(generation===epoch)
        nativeStatus="Code non encore validé, expiré ou refusé. "+
          "Votre session Jellyfin est conservée.";
    }finally{if(generation===epoch)nativeBusy=false;}
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
      void loadNative(generation,version);
    }).catch(()=>{
      // Keep existing shelves on timeout, denial or offline network.
    });
  }
  async function logout(){
    // Do not wait on Cloudflare before immediately ending Jellyfin access.
    void g7zClient.forget().catch(()=>{});
    epoch++;refreshVersion++;profileOpen=false;credentialStored=false;
    nativeLinked=false;nativeBusy=false;nativeCode="";nativeStatus="";
    nativePersonal=null;nativeG7yRows=null;
    if(searchTimer!==null)clearTimeout(searchTimer);
    api.logout();artwork.clear();
    session=null;selected=null;tab="home";heroIndex=0;
    loginPassword="";loginName="";loginError="";vaultNotice="";
    searchText="";searchRows=[];searchBusy=false;data=empty();homeWarning="";
    catalogs={Movie:freshCatalog(),Series:freshCatalog(),Anime:freshCatalog()};
    favoriteCatalogs={Movie:freshCatalog(),Series:freshCatalog(),Anime:freshCatalog()};
    // Clear the system vault before permitting a new login.
    loginBusy=true;
    try{await nativeVault.clear();}
    catch{vaultNotice="Impossible d'effacer la connexion mémorisée sur cet appareil.";}
    finally{loginBusy=false;}
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
<svelte:window
  onkeydown={(event)=>{if(event.key==="Escape")profileOpen=false;}}
  onclick={(event)=>{
    if(profileOpen && event.target instanceof Element &&
       !event.target.closest(".vy-account-wrap"))profileOpen=false;
  }} />
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
        {#if vaultNotice}<p class="vy-auth-hint" role="status">{vaultNotice}</p>{/if}
        {#if nativeVault.available}
          <label class="vy-remember">
            <input type="checkbox" bind:checked={rememberMe} />
            <span>Rester connecté sur cet appareil</span>
          </label>
        {/if}
        <button type="submit" class="vy-primary" disabled={loginBusy || restoreBusy}>
          {restoreBusy?"Restauration de la session…":loginBusy?"Connexion…":"Se connecter"}
        </button>
        <span class="vy-auth-hint">
          {nativeVault.available
            ?"Session enregistrée dans le coffre sécurisé de votre système."
            :"Les identifiants ne sont pas enregistrés par Vynéo."}
        </span>
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
        <div class="vy-account-wrap">
          <button type="button" class="vy-account" title="Mon profil"
            aria-label="Ouvrir le profil" aria-haspopup="dialog"
            aria-expanded={profileOpen}
            onclick={()=>profileOpen=!profileOpen}>
            {session.username.slice(0,1).toUpperCase()}
          </button>
          {#if profileOpen}
            <section class="vy-account-menu" aria-label="Profil Vynéo">
              <strong>{session.username}</strong>
              <small>{vaultNotice ||
                (credentialStored
                  ?"Connexion mémorisée sur cet appareil"
                  :"Session active, non mémorisée")}</small>
              {#if g7zClient.available}
                <div class="vy-native-association">
                  <strong>Recommandations G7y · IA locale</strong>
                  {#if nativeCode}
                    <p>Depuis votre navigateur, ouvrez Vynéo Preview,
                      puis Profil → Associer Vynéo Desktop.</p>
                    <output class="vy-native-code" aria-label="Code d'association">
                      {nativeCode}
                    </output>
                    <button type="button" disabled={nativeBusy}
                      onclick={()=>void finishNativeLink()}>
                      {nativeBusy?"Vérification…":"J'ai autorisé cet appareil"}
                    </button>
                  {:else}
                    <button type="button" disabled={nativeBusy}
                      onclick={()=>void startNativeLink()}>
                      {nativeBusy?"Connexion sécurisée…":
                        nativeLinked?"Actualiser les recommandations IA":
                        "Activer les recommandations IA"}
                    </button>
                  {/if}
                  {#if nativeStatus}
                    <small role="status">{nativeStatus}</small>
                  {/if}
                </div>
              {/if}
              <button type="button" onclick={()=>void logout()}>
                Se déconnecter
              </button>
            </section>
          {/if}
        </div>
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
