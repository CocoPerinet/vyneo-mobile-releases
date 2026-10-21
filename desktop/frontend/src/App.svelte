<script lang="ts">
  import type {LibrarySnapshot,MediaItem,SessionPublic,ViewKey,Shelf,CatalogKind} from "./types";
  import {onMount} from "svelte";
  import {nativeVault} from "./credential-vault";
  import {JellyfinApi} from "./api";
  import {ArtworkCache,hasArtwork,lazyArtwork} from "./artwork";
  import {buildShelves,featuredSlides} from "./discover";
  import {newBadge,classifyNewReleases,includeNewReleaseShelf} from "./new-seasons";
  import type {RecentSeason} from "./new-seasons";
  import {UNIVERSES,universeItems,groupUniverseItems} from "./universes";
  import type {UniverseId} from "./universes";
  import ShelfRail from "./ShelfRail.svelte";
  import UniverseRail from "./UniverseRail.svelte";
  import HoverPreview from "./HoverPreview.svelte";
  import VyIcon from "./VyIcon.svelte";
  import MediaCard from "./MediaCard.svelte";
  import UniverseEntry from "./UniverseEntry.svelte";
  import MediaDetails from "./MediaDetails.svelte";
  import {planMediaMutation,projectMediaMutation} from "./media-actions";
  import type {MediaAction} from "./media-actions";

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
  let avatarUrl=$state<string|null>(null);
  let session=$state<SessionPublic|null>(null);
  let data=$state<LibrarySnapshot>(empty());
  let recentSeasons=$state<RecentSeason[]>([]);
  let seriesEvidence=$state<MediaItem[]>([]);
  let hiddenCards=$state<string[]>([]);
  let universeCatalog=$state<MediaItem[]>([]);
  let activeUniverse=$state<UniverseId|null>(null);
  let universeGroupIndex=$state(0);
  let universeLoading=$state(false);
  let universeError=$state("");
  let hover=$state<{
    item:MediaItem;x:number;y:number;source:string;
  }|null>(null);
  let hoverBusy=$state(false);
  let hoverDetailsPending=$state(false);
  let hoverFavoriteUnavailable=$state(false);
  let hoverError=$state("");
  // Bounded, user-scoped metadata cache: no item from another account survives logout.
  const hoverDetailsCache=new Map<string,{
    at:number;promise:Promise<MediaItem>
  }>();
  let scrollPosition=$state(0);
  let verifiedHeroFavorite=$state<{id:string;favorite:boolean}|null>(null);
  let hoverOpenTimer:ReturnType<typeof setTimeout>|null=null;
  let hoverCloseTimer:ReturnType<typeof setTimeout>|null=null;
  let hoverKeyboardOrigin:HTMLElement|null=null;
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
  let searchSequence=0;
  const tabs:Array<{key:ViewKey;label:string}>= [
    {key:"home",label:"Accueil"},
    {key:"anime",label:"Animés"},
    {key:"movies",label:"Films"},
    {key:"series",label:"Séries"},
    {key:"favorites",label:"Ma liste"}
  ];
  let catalogKind=$derived<CatalogKind|null>(
    tab==="movies"?"Movie":tab==="series"?"Series":tab==="anime"?"Anime":null);
  let heroIndex=$state(0);
  let shelves=$derived.by(()=>{
    if(!session)return [];
    const rows=includeNewReleaseShelf(buildShelves(data,session.userId),
      data,recentSeasons,seriesEvidence);
    return rows.filter(row=>row.id!=="universes").map(row=>
      row.id==="next-up" || row.id==="resume"?
      {...row,items:row.items.filter(item=>!hiddenCards.includes(item.id))}:row
    ).filter(row=>row.items.length>0);
  });
  let seasonBadges=$derived([
    ...recentSeasons,
    ...classifyNewReleases(data,recentSeasons,seriesEvidence).relevantSeasons
  ]);
  let heroSlides=$derived(featuredSlides(shelves));
  let hero=$derived(heroSlides[heroIndex%Math.max(1,heroSlides.length)]??null);
  let gridItems=$derived.by(()=>{
    if(tab==="movies")return catalogs.Movie.items;
    if(tab==="series")return catalogs.Series.items;
    if(tab==="anime")return catalogs.Anime.items;
    if(tab==="universes" && activeUniverse)
      return universeItems(activeUniverse,universeCatalog);
    if(tab==="universes")return [];
    return [];
  });
  let searchActive=$derived(searchText.trim().length>=2);
  let activeUniverseGroups=$derived(activeUniverse?
    groupUniverseItems(activeUniverse,universeCatalog):[]);
  // Hero episodes inherit the parent series favorite state. Never guess
  // from the episode's UserData or a stale NextUp snapshot.
  $effect(()=>{
    const current=hero,uid=session?.userId;
    verifiedHeroFavorite=null;
    if(!current || !uid)return;
    let disposed=false;
    void detailFor(current,uid).then(item=>{
      if(!disposed && session?.userId===uid && hero?.id===current.id)
        verifiedHeroFavorite={id:current.id,favorite:item.isFavorite};
    }).catch(()=>{});
    return ()=>{disposed=true;};
  });

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
  function clearAvatar(){
    if(avatarUrl)URL.revokeObjectURL(avatarUrl);
    avatarUrl=null;
  }
  function loadAvatar(generation=epoch){
    const uid=session?.userId;
    if(!uid)return;
    void api.getUserAvatar().then(image=>{
      if(generation!==epoch || session?.userId!==uid || !image)return;
      clearAvatar();
      avatarUrl=URL.createObjectURL(image);
    }).catch(()=>{});
  }
  function closeHover(restoreKeyboardFocus=false){
    if(hoverOpenTimer!==null)clearTimeout(hoverOpenTimer);
    if(hoverCloseTimer!==null)clearTimeout(hoverCloseTimer);
    const origin=hoverKeyboardOrigin;
    hoverOpenTimer=null;hoverCloseTimer=null;hoverKeyboardOrigin=null;
    hover=null;hoverError="";
    hoverDetailsPending=false;
    hoverFavoriteUnavailable=false;
    if(restoreKeyboardFocus && origin?.isConnected)
      origin.focus({preventScroll:true});
  }
  function detailFor(item:MediaItem,uid:string):Promise<MediaItem>{
    const key=uid+":"+item.id.toLowerCase();
    const now=Date.now(),entry=hoverDetailsCache.get(key);
    if(entry && now-entry.at<120000){
      hoverDetailsCache.delete(key);
      hoverDetailsCache.set(key,entry);
      return entry.promise;
    }
    const promise=api.getItemDetails(item.id).then(async fresh=>{
      if(fresh.type!=="Episode" || !fresh.seriesId)return fresh;
      const parent=await api.getItemDetails(fresh.seriesId);
      // An episode heart controls the parent series, not the episode.
      return {...fresh,isFavorite:parent.isFavorite};
    });
    const next={at:now,promise};
    hoverDetailsCache.set(key,next);
    while(hoverDetailsCache.size>140)
      hoverDetailsCache.delete(hoverDetailsCache.keys().next().value!);
    void promise.catch(()=>{
      if(hoverDetailsCache.get(key)===next)hoverDetailsCache.delete(key);
    });
    return promise;
  }
  async function hydrateHover(item:MediaItem,generation:number,uid:string){
    hoverDetailsPending=item.type==="Episode" && !!item.seriesId;
    try{
      const details=await detailFor(item,uid);
      if(generation===epoch && session?.userId===uid &&
        hover?.item.id===item.id){
        hover={...hover,item:details};
        hoverFavoriteUnavailable=false;
      }
    }catch{
      // Without the parent series state, an episode's heart could toggle
      // the opposite value. Keep playback/metadata available, but fail closed.
      if(generation===epoch && session?.userId===uid &&
        hover?.item.id===item.id && item.type==="Episode" && item.seriesId){
        hoverFavoriteUnavailable=true;
        hoverError="Favori de la série indisponible. Rouvrez l'aperçu pour réessayer.";
      }
    }finally{
      if(generation===epoch && session?.userId===uid &&
        hover?.item.id===item.id)hoverDetailsPending=false;
    }
  }
  function requestHover(item:MediaItem,element:HTMLElement,source:string,
    trigger:"pointer"|"keyboard"="pointer"){
    if(trigger==="pointer" &&
      !window.matchMedia("(hover:hover) and (pointer:fine)").matches)return;
    if(hoverOpenTimer!==null)clearTimeout(hoverOpenTimer);
    if(hoverCloseTimer!==null)clearTimeout(hoverCloseTimer);
    hoverKeyboardOrigin=trigger==="keyboard"
      ?element.querySelector<HTMLElement>(".vy-card-main"):null;
    const generation=epoch;
    hoverOpenTimer=setTimeout(()=>{
      hoverOpenTimer=null;
      if(generation!==epoch || !element.isConnected || !session)return;
      // Use the current bounding box, not one captured before delayed scroll.
      const rect=element.getBoundingClientRect();
      const width=Math.min(320,window.innerWidth-28);
      const x=Math.max(14,Math.min(window.innerWidth-width-14,
        rect.left+(rect.width-width)/2));
      const y=Math.max(86,Math.min(rect.top-95,
        Math.max(86,window.innerHeight-430)));
      hover={item,x,y,source};hoverError="";
      hoverFavoriteUnavailable=false;
      void hydrateHover(item,generation,session.userId);
      if(trigger==="keyboard")
        requestAnimationFrame(()=>{
          if(hover?.item.id===item.id)
            document.querySelector<HTMLButtonElement>(
              ".vy-hover-popup .vy-icon-primary")?.focus({preventScroll:true});
        });
    },trigger==="keyboard"?0:420);
  }
  function requestHideHover(){
    if(hoverOpenTimer!==null)clearTimeout(hoverOpenTimer);
    hoverOpenTimer=null;
    if(hoverCloseTimer!==null)clearTimeout(hoverCloseTimer);
    if(document.activeElement?.closest(".vy-hover-popup"))return;
    hoverCloseTimer=setTimeout(()=>{hover=null;hoverError="";
      hoverKeyboardOrigin=null;},210);
  }
  function holdHover(){
    if(hoverCloseTimer!==null)clearTimeout(hoverCloseTimer);
    hoverCloseTimer=null;
  }
  const badgeFor=(item:MediaItem)=>
    newBadge(item,seasonBadges)?.label??null;
  function openMedia(item:MediaItem){
    closeHover();selected=item;
  }
  async function changeMediaState(shown:MediaItem,
    action:MediaAction):Promise<boolean>{
    if(hoverBusy || !session)return false;
    const mutation=planMediaMutation(shown,action);
    if(!mutation)return false;
    const uid=session.userId,generation=epoch;
    const {targetId,enabled}=mutation;
    hoverBusy=true;hoverError="";
    try{
      await api.updateMediaState(targetId,action,enabled);
      hoverDetailsCache.delete(uid+":"+targetId.toLowerCase());
      hoverDetailsCache.delete(uid+":"+shown.id.toLowerCase());
      if(generation!==epoch || session?.userId!==uid)return false;
      const rewrite=(item:MediaItem)=>
        projectMediaMutation(item,shown,mutation,action);
      data={...data,
        recent:data.recent.map(rewrite),resume:data.resume.map(rewrite),
        nextUp:data.nextUp.map(rewrite),watched:data.watched.map(rewrite),
        favorites:data.favorites.map(rewrite),
        candidates:data.candidates?.map(rewrite)};
      catalogs=Object.fromEntries(Object.entries(catalogs).map(([key,value])=>
        [key,{...value,items:value.items.map(rewrite)}])
      ) as Record<CatalogKind,CatalogState>;
      favoriteCatalogs=Object.fromEntries(Object.entries(favoriteCatalogs)
        .map(([key,value])=>[key,{...value,items:value.items.map(rewrite)}])
      ) as Record<CatalogKind,CatalogState>;
      if(selected)selected=rewrite(selected);
      // Universe rows must reflect API-confirmed favorite/played mutations
      // immediately; the catalogue is a distinct, on-demand data snapshot.
      if(universeCatalog.length)
        universeCatalog=universeCatalog.map(rewrite);
      if(hover)hover={...hover,item:rewrite(hover.item)};
      if(verifiedHeroFavorite?.id===shown.id && action==="favorite")
        verifiedHeroFavorite={id:shown.id,favorite:enabled};
      if(action==="favorite")void api.getFavorites().then(items=>{
        if(generation===epoch && session?.userId===uid)
          data={...data,favorites:items};
      }).catch(()=>{});
      if(action==="played")void api.getNextUp().then(items=>{
        if(generation===epoch && session?.userId===uid)
          data={...data,nextUp:items};
      }).catch(()=>{});
      return true;
    }catch{
      if(generation===epoch)hoverError="Modification refusée par Jellyfin.";
      return false;
    }finally{if(generation===epoch)hoverBusy=false;}
  }
  async function toggleHoverState(action:"favorite"|"played"){
    if(hover && (action!=="favorite" ||
      (!hoverDetailsPending && !hoverFavoriteUnavailable)))
      await changeMediaState(hover.item,action);
  }
  async function toggleHeroState(action:MediaAction){
    if(!hero)return;
    if(action==="favorite"){
      if(verifiedHeroFavorite?.id!==hero.id)return;
      await changeMediaState({...hero,isFavorite:verifiedHeroFavorite.favorite},
        action);
    }else await changeMediaState(hero,action);
  }
  function hideFromThisDevice(){
    if(!hover || !session)return;
    const id=hover.item.id;
    if(!hiddenCards.includes(id))hiddenCards=[...hiddenCards,id].slice(-500);
    try{localStorage.setItem("vyneo.hidden."+session.userId,
      JSON.stringify(hiddenCards));}catch{}
    closeHover();
  }
  function restoreHiddenCards(){
    if(!session)return;
    hiddenCards=[];
    try{localStorage.removeItem("vyneo.hidden."+session.userId);}catch{}
    profileOpen=false;
  }
  async function loadUniverse(){
    if(universeLoading || !session || universeCatalog.length)return;
    const generation=epoch,uid=session.userId;
    universeLoading=true;universeError="";
    try{
      const results=await api.getUniverseCatalog();
      if(generation!==epoch || session?.userId!==uid)return;
      universeCatalog=results;
    }catch{
      if(generation===epoch)
        universeError="Impossible de charger les univers. Réessayez.";
    }finally{if(generation===epoch)universeLoading=false;}
  }
  function openUniverse(next:UniverseId){
    selectTab("universes");
    activeUniverse=next;
    universeGroupIndex=0;
    void loadUniverse();
  }
  function moveHero(step:number){
    if(heroSlides.length>1)
      heroIndex=(heroIndex+step+heroSlides.length)%heroSlides.length;
  }
  function keepActiveNavVisible(){
    const nav=document.querySelector<HTMLElement>(".vy-header .vy-nav");
    const active=nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if(!nav || !active)return;
    const bounds=nav.getBoundingClientRect();
    const item=active.getBoundingClientRect();
    if(item.left<bounds.left+8)
      nav.scrollBy({left:item.left-bounds.left-14,behavior:"instant"});
    else if(item.right>bounds.right-8)
      nav.scrollBy({left:item.right-bounds.right+14,behavior:"instant"});
  }
  function selectTab(next:ViewKey){
    closeHover();
    tab=next;selected=null;searchText="";searchRows=[];
    searchBusy=false;searchSequence++;
    if(searchTimer!==null)clearTimeout(searchTimer);
    profileOpen=false;
    activeUniverse=null;universeGroupIndex=0;
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
    requestAnimationFrame(keepActiveNavVisible);
  }
  function acceptSession(authenticated:SessionPublic){
    session=authenticated;profileOpen=false;
    recentSeasons=[];seriesEvidence=[];hiddenCards=[];
    universeCatalog=[];activeUniverse=null;universeError="";
    closeHover();clearAvatar();hoverDetailsCache.clear();
    const generation=++epoch;
    loadAvatar(generation);
    try{
      const ids=JSON.parse(localStorage.getItem(
        "vyneo.hidden."+authenticated.userId)??"[]");
      if(Array.isArray(ids))hiddenCards=ids.filter(
        (v):v is string=>typeof v==="string" && /^[a-f0-9]{32}$/i.test(v))
        .slice(0,500);
    }catch{}
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
    requestAnimationFrame(keepActiveNavVisible);
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
    recentSeasons=[];seriesEvidence=[];
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
    // This background metadata pass is independent of the first paint.
    // Never infer a season from DateCreated or an unseen Jellyfin Series.
    void Promise.allSettled([
      api.getRecentSeasons(),api.getNextUpSeries(data.nextUp)
    ]).then(result=>{
      if(generation!==epoch || version!==refreshVersion ||
        session?.userId!==api.session?.userId)return;
      recentSeasons=result[0].status==="fulfilled"?result[0].value:[];
      seriesEvidence=result[1].status==="fulfilled"?result[1].value:[];
    });
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
  async function logout(){
    epoch++;refreshVersion++;profileOpen=false;credentialStored=false;
    closeHover();clearAvatar();hoverDetailsCache.clear();
    hiddenCards=[];recentSeasons=[];seriesEvidence=[];
    universeCatalog=[];activeUniverse=null;universeError="";
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
    const request=++searchSequence,query=searchText.trim();
    searchRows=[];
    if(query.length<2){searchBusy=false;return;}
    const generation=epoch;
    searchBusy=true;
    searchTimer=setTimeout(async()=>{
      try{
        const rows=await api.search(query);
        if(generation===epoch && searchSequence===request)
          searchRows=rows;
      }catch{
        if(generation===epoch && searchSequence===request)searchRows=[];
      }finally{
        if(generation===epoch && searchSequence===request)searchBusy=false;
      }
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
  onscroll={()=>{scrollPosition=window.scrollY;closeHover();}}
  onresize={()=>{
    closeHover();requestAnimationFrame(keepActiveNavVisible);
  }}
  onkeydown={(event)=>{
    if(event.key==="Escape"){
      profileOpen=false;
      const returnFocus=!!hoverKeyboardOrigin &&
        event.target instanceof Element &&
        !!event.target.closest(".vy-hover-popup");
      closeHover(returnFocus);
      if(returnFocus)event.preventDefault();
    }
  }}
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
    <header class="vy-header"
      class:vy-header-over-hero={tab==="home"&&!searchActive&&scrollPosition<28}>
      <button type="button" class="vy-logo vy-logo-button"
        aria-label="Retour à l'accueil" onclick={()=>selectTab("home")}>Vynéo</button>
      <nav class="vy-nav" aria-label="Navigation principale">
        {#each tabs as entry (entry.key)}
          <button type="button"
            class:active={tab===entry.key ||
              (tab==="universes" && entry.key==="home")}
            aria-current={tab===entry.key ||
              (tab==="universes" && entry.key==="home")?"page":undefined}
            onclick={()=>selectTab(entry.key)}>{entry.label}</button>
        {/each}
      </nav>
      <div class="vy-toolbar">
        <label class="vy-search-label">
          <span class="vy-search-icon" aria-hidden="true">
            <VyIcon kind="search" size={20}/>
          </span>
          <input type="search" aria-label="Rechercher dans ma bibliothèque"
            placeholder="Rechercher un film, une série…" bind:value={searchText}
            oninput={updateSearch} />
        </label>
        <div class="vy-account-wrap">
          <button type="button" class="vy-account" title="Mon profil"
            aria-label="Ouvrir le profil" aria-haspopup="dialog"
            aria-expanded={profileOpen}
            onclick={()=>profileOpen=!profileOpen}>
            {#if avatarUrl}
              <img class="vy-avatar-image" src={avatarUrl} alt=""/>
            {:else}
              {session.username.slice(0,1).toUpperCase()}
            {/if}
          </button>
          {#if profileOpen}
            <section class="vy-account-menu" aria-label="Profil Vynéo">
              <strong>{session.username}</strong>
              <small>{vaultNotice ||
                (credentialStored
                  ?"Connexion mémorisée sur cet appareil"
                  :"Session active, non mémorisée")}</small>
              {#if hiddenCards.length}
                <button type="button" onclick={restoreHiddenCards}>
                  Réafficher les {hiddenCards.length} titres masqués
                </button>
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
                novelty={badgeFor(item)}
                onhover={(element,trigger)=>
                  requestHover(item,element,"search",trigger)}
                onleave={requestHideHover}
                onclick={openMedia} />
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
                <button type="button" class="vy-icon-button vy-hero-action-icon"
                  aria-label={verifiedHeroFavorite?.id!==hero.id
                    ?"Vérification du favori":verifiedHeroFavorite.favorite
                    ?"Retirer de ma liste":"Ajouter à ma liste"}
                  title="Ma liste"
                  class:active={verifiedHeroFavorite?.id===hero.id &&
                    verifiedHeroFavorite.favorite}
                  disabled={hoverBusy || verifiedHeroFavorite?.id!==hero.id}
                  onclick={()=>void toggleHeroState("favorite")}>
                  <VyIcon kind="heart" size={19}/>
                </button>
                <button type="button" class="vy-icon-button vy-hero-action-icon"
                  aria-label={hero.played?"Marquer non vu":"Marquer vu"}
                  title="Vu / non vu" class:active={hero.played}
                  disabled={hoverBusy}
                  onclick={()=>void toggleHeroState("played")}>
                  <VyIcon kind="check" size={18}/>
                </button>
                <button type="button" class="vy-icon-button vy-hero-action-icon"
                  aria-label={"Informations : "+hero.title} title="Voir la fiche"
                  onclick={()=>openMedia(hero)}>
                  <VyIcon kind="info" size={19}/>
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
                <VyIcon kind="chevron-left" size={22}/>
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
                <VyIcon kind="chevron-right" size={22}/>
              </button>
            </div>
          {/if}
        </section>
        <div class="vy-shelves">
          {#each shelves as shelf (shelf.id)}
            <ShelfRail {shelf} cache={artwork} onclick={openMedia}
              badge={badgeFor} onhover={requestHover}
              onleave={requestHideHover} />
            {#if shelf.id==="new-seasons" ||
              (shelf.id==="next-up" && !shelves.some(s=>s.id==="new-seasons"))}
              <UniverseRail onselect={openUniverse}/>
            {/if}
          {/each}
          {#if !shelves.some(s=>s.id==="new-seasons" || s.id==="next-up")}
            <UniverseRail onselect={openUniverse}/>
          {/if}
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
            {#if group.items.length}
              <ShelfRail
                shelf={{id:"favorite-"+entry.kind,title:entry.label,
                  items:group.items}} cache={artwork} onclick={openMedia}
                badge={badgeFor} onhover={requestHover}
                onleave={requestHideHover} showCount={true}/>
            {:else}
              <section class="vy-shelf vy-favorites-shelf" aria-label={entry.label}>
                <h2>{entry.label}</h2>
                {#if group.loading}
                  <p class="vy-empty">Chargement de votre liste…</p>
                {:else if group.libraryAvailable===false}
                  <p class="vy-empty">Bibliothèque non accessible à votre compte.</p>
                {:else if group.loaded && !group.error}
                  <p class="vy-empty">Aucun favori dans cette bibliothèque.</p>
                {/if}
              </section>
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
          {/each}
        </section>
      {:else if tab==="universes"}
        <section class="vy-browser vy-universes-page">
          {#if activeUniverse}
            <button type="button" class="vy-universe-back"
              onclick={()=>{activeUniverse=null;closeHover();}}>
              ‹ Tous les univers
            </button>
            <div class="vy-browser-heading vy-universe-heading">
              <img class="vy-universe-page-logo" data-vy-universe={activeUniverse}
                src={UNIVERSES.find(u=>u.id===activeUniverse)?.logo??""}
                alt={UNIVERSES.find(u=>u.id===activeUniverse)?.label??"Univers"}/>
              <h1>{UNIVERSES.find(u=>u.id===activeUniverse)?.label??"Univers"}</h1>
            </div>
            {#if universeLoading}
              <p class="vy-empty">Recherche des œuvres autorisées dans Jellyfin…</p>
            {:else if universeError}
              <p class="vy-empty" role="alert">{universeError}</p>
              <button type="button" class="vy-universe-retry"
                onclick={()=>void loadUniverse()}>Réessayer</button>
            {:else if activeUniverseGroups.length}
              <div class="vy-universe-tabs" role="tablist"
                aria-label={"Époques de "+(UNIVERSES.find(u=>
                  u.id===activeUniverse)?.label??"cet univers")}>
                {#each activeUniverseGroups as group,index (group.name)}
                  <button type="button" role="tab"
                    data-vy-universe-group={group.name}
                    class:active={universeGroupIndex===index}
                    aria-selected={universeGroupIndex===index}
                    aria-controls="vy-universe-current-list"
                    tabindex={universeGroupIndex===index?0:-1}
                    onclick={()=>universeGroupIndex=index}
                    onkeydown={(event)=>{
                      const key=event.key;
                      if(!["ArrowLeft","ArrowRight","Home","End"].includes(key))return;
                      event.preventDefault();
                      const count=activeUniverseGroups.length;
                      universeGroupIndex=key==="Home"?0:
                        key==="End"?count-1:
                        (index+(key==="ArrowRight"?1:count-1))%count;
                      requestAnimationFrame(()=>
                        document.querySelectorAll<HTMLButtonElement>(
                          ".vy-universe-tabs [role=tab]")[universeGroupIndex]
                          ?.focus({preventScroll:true}));
                    }}>{group.name}</button>
                {/each}
              </div>
              {#each activeUniverseGroups as group,index (group.name)}
                {#if universeGroupIndex===index}
                  <div class="vy-universe-list" role="tabpanel"
                    id="vy-universe-current-list" aria-label={group.name}>
                    {#each group.items as item (item.id)}
                      <UniverseEntry {item} cache={artwork} busy={hoverBusy}
                        onopen={openMedia}
                        onfavorite={(media)=>void changeMediaState(media,"favorite")}
                        onplayed={(media)=>void changeMediaState(media,"played")}/>
                    {/each}
                  </div>
                {/if}
              {/each}
            {:else}
              <p class="vy-empty">Aucun titre de cet univers n'est présent dans
                votre bibliothèque accessible.</p>
            {/if}
          {:else}
            <h1>Univers</h1>
            <p class="vy-universes-intro">Explorez les œuvres regroupées à partir
              des studios et des métadonnées de votre bibliothèque Jellyfin.</p>
            <UniverseRail onselect={openUniverse}/>
          {/if}
        </section>
      {:else}
        <section class="vy-browser">
          <div class="vy-browser-heading">
            <div>
              <span class="vy-kicker">VOTRE BIBLIOTHÈQUE</span>
              <h1>{titleFor(tab)}</h1>
            </div>

          </div>
          <div class="vy-catalog-grid">
            {#each gridItems as item (item.id)}
              <MediaCard {item} cache={artwork}
                novelty={badgeFor(item)}
                onhover={(element,trigger)=>
                  requestHover(item,element,"catalog",trigger)}
                onleave={requestHideHover}
                onclick={openMedia} />
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
    {#if hover && !selected}
      <HoverPreview item={hover.item} cache={artwork}
        x={hover.x} y={hover.y} source={hover.source}
        novelty={badgeFor(hover.item)}
        busy={hoverBusy} parentLoading={hoverDetailsPending}
        parentUnavailable={hoverFavoriteUnavailable} error={hoverError}
        onopen={()=>openMedia(hover!.item)}
        onfavorite={()=>void toggleHoverState("favorite")}
        onplayed={()=>void toggleHoverState("played")}
        onhide={hideFromThisDevice}
        onenter={holdHover} onleave={requestHideHover}/>
    {/if}
    {#if selected}
      <MediaDetails item={selected} {api} cache={artwork}
        onaction={changeMediaState}
        onclose={()=>selected=null}/>
    {/if}
  {/if}
</div>