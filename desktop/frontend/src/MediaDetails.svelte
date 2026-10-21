<script lang="ts">
  import {onMount,tick} from "svelte";
  import {isTauri} from "@tauri-apps/api/core";
  import {selectDirectMp4,selectJellyfinHls,resumeAtSeconds} from "./native-playback";
  import type Hls from "hls.js";
  import type {NativeStreamTicket} from "./native-playback";
  import {PlaybackReporter,playbackClock} from "./playback-report";
  import type {JellyfinApi} from "./api";
  import type {MediaAction} from "./media-actions";
  import VyIcon from "./VyIcon.svelte";
  import type {ArtworkCache} from "./artwork";
  import {hasArtwork,lazyArtwork} from "./artwork";
  import type {EpisodePage,MediaItem,PlaybackProbe,SeasonSummary} from "./types";

  type Props={
    item:MediaItem;
    api:JellyfinApi;
    cache:ArtworkCache;
    onaction:(item:MediaItem,action:MediaAction)=>Promise<boolean>;
    onclose:()=>void;
    onplaybackchange:()=>void;
  };
  let {item,api,cache,onaction,onclose,onplaybackchange}:Props=$props();
  let media=$state<MediaItem|null>(null);
  let seasons=$state<SeasonSummary[]>([]);
  let seasonsLoading=$state(false);
  let seasonsError=$state("");
  let activeSeason=$state<string|null>(null);
  let episodes=$state<MediaItem[]>([]);
  let episodeTotal=$state<number|null>(null);
  let nextOffset=$state<number|null>(0);
  let episodeLoading=$state(false);
  let episodeError=$state("");
  let focusedEpisode=$state<MediaItem|null>(null);
  let playback=$state<PlaybackProbe|null>(null);
  let playbackBusy=$state(false);
  let playbackError=$state("");
  let streamTicket=$state<NativeStreamTicket|null>(null);
  let streamKind=$state<"direct"|"hls"|null>(null);
  let hlsPlayer:Hls|null=null;
  let reporter:PlaybackReporter|null=null;
  let playbackNotificationSent=false;
  let reportWarning=$state("");
  let streamBusy=$state(false);
  let streamError=$state("");
  let streamStarted=$state(false);
  let videoElement=$state<HTMLVideoElement|undefined>(undefined);
  let streamEpoch=0;
  const nativeAvailable=isTauri();
  let favoriteParent=$state<{id:string;isFavorite:boolean}|null>(null);
  let stateBusy=$state(false);
  let stateError=$state("");
  let epoch=0,seasonEpoch=0,playbackEpoch=0;
  let closeButton:HTMLButtonElement;
  let shown=$derived(focusedEpisode??media??item);
  let favoriteUnavailable=$derived(shown.type==="Episode"
    ?!shown.seriesId || favoriteParent?.id!==shown.seriesId
    :media?.id!==shown.id);
  let isFavorite=$derived(shown.type==="Episode"
    ?favoriteParent?.isFavorite??false:shown.isFavorite);
  const duration=(ticks:number|null|undefined)=>
    typeof ticks==="number" && ticks>0
      ?Math.max(1,Math.round(ticks/600_000_000))+" min":"";
  const bitrate=(bits:number|null)=>bits
    ?(bits/1_000_000).toFixed(1)+" Mb/s":"débit inconnu";
  const episodeLabel=(media:MediaItem)=>{
    const season=media.seasonNumber;
    const episode=media.episodeNumber;
    return season!==null && season!==undefined &&
      episode!==null && episode!==undefined
      ?"S"+String(season).padStart(2,"0")+
       "E"+String(episode).padStart(2,"0"):"Épisode";
  };
  onMount(()=>{
    closeButton?.focus();
    void hydrate();
    return ()=>{
      epoch++;seasonEpoch++;playbackEpoch++;streamEpoch++;
      stopStream();
    };
  });
  async function hydrate(){
    const version=epoch;
    // Seasons do not wait for the full item's metadata: either endpoint
    // can respond first and the series is navigable while posters load.
    if(item.type==="Series"){
      seasonsLoading=true;seasonsError="";
      void api.getSeriesSeasons(item.id).then(results=>{
        if(version!==epoch)return;
        seasons=results;
        if(results.length)chooseSeason(results[0].id);
      }).catch(()=>{
        if(version===epoch)seasonsError="Saisons momentanément indisponibles.";
      }).finally(()=>{
        if(version===epoch)seasonsLoading=false;
      });
    }
    try{
      const fresh=await api.getItemDetails(item.id);
      if(version!==epoch)return;
      media=fresh;
      if(fresh.type==="Series"){
        favoriteParent={id:fresh.id,isFavorite:fresh.isFavorite};
      }else if(fresh.type==="Episode" && fresh.seriesId){
        favoriteParent=null;
        try{
          const parent=await api.getItemDetails(fresh.seriesId);
          if(version===epoch && parent.id===fresh.seriesId &&
            parent.type==="Series")
            favoriteParent={id:parent.id,isFavorite:parent.isFavorite};
        }catch{/* Unverified parent: the heart remains disabled. */}
      }
    }catch{/* Original catalog card remains available. */}
  }
  function chooseSeason(id:string){
    streamEpoch++;stopStream();streamError="";
    seasonEpoch++;
    activeSeason=id;episodes=[];episodeTotal=null;nextOffset=0;
    episodeError="";episodeLoading=false;focusedEpisode=null;
    playback=null;playbackError="";playbackBusy=false;playbackEpoch++;
    stateError="";
    void loadEpisodes();
  }
  async function loadEpisodes(){
    if(!activeSeason || episodeLoading || nextOffset===null)return;
    const offset=nextOffset,season=activeSeason;
    const version=epoch,request=seasonEpoch;
    episodeLoading=true;episodeError="";
    try{
      const page:EpisodePage=await api.getSeasonEpisodes(item.id,season,offset);
      if(version!==epoch || request!==seasonEpoch || season!==activeSeason)return;
      const seen=new Set(episodes.map(episode=>episode.id));
      const fresh=page.items.filter(episode=>{
        if(seen.has(episode.id))return false;
        seen.add(episode.id);return true;
      });
      episodes=[...episodes,...fresh];
      nextOffset=page.nextOffset;episodeTotal=page.total;
    }catch{
      if(version===epoch && request===seasonEpoch)
        episodeError="Impossible de récupérer les épisodes. Réessayez.";
    }finally{
      if(version===epoch && request===seasonEpoch)episodeLoading=false;
    }
  }
  function focusEpisode(episode:MediaItem){
    streamEpoch++;stopStream();streamError="";
    focusedEpisode=episode;playback=null;playbackError="";
    playbackBusy=false;playbackEpoch++;stateError="";
  }
  async function mutateMedia(action:MediaAction){
    if(stateBusy || (action==="favorite" && favoriteUnavailable))return;
    const target={...shown,isFavorite},targetId=target.id;
    const version=epoch;
    stateBusy=true;stateError="";
    try{
      const updated=await onaction(target,action);
      if(version!==epoch || shown.id!==targetId)return;
      if(!updated){
        stateError="Modification refusée par Jellyfin. Réessayez.";
        return;
      }
      if(action==="favorite"){
        const next=!isFavorite;
        if(target.type==="Episode" && favoriteParent)
          favoriteParent={...favoriteParent,isFavorite:next};
        if(media && (media.id===target.id ||
          media.id===target.seriesId))
          media={...media,isFavorite:next};
        if(focusedEpisode && focusedEpisode.id===targetId)
          focusedEpisode={...focusedEpisode,isFavorite:next};
      }else{
        const next=!target.played;
        const apply=(entry:MediaItem):MediaItem=>
          entry.id===targetId?{...entry,played:next,
            progress:next?null:entry.progress,
            resumeTicks:next?null:entry.resumeTicks}:entry;
        if(media)media=apply(media);
        if(focusedEpisode)focusedEpisode=apply(focusedEpisode);
        episodes=episodes.map(apply);
      }
    }catch{
      if(version===epoch && shown.id===targetId)
        stateError="Modification refusée par Jellyfin. Réessayez.";
    }finally{
      if(version===epoch)stateBusy=false;
    }
  }
  async function inspectPlayback(){
    const target=shown,request=++playbackEpoch,version=epoch;
    playback=null;playbackError="";playbackBusy=true;
    try{
      const result=await api.getPlaybackInfo(target.id);
      if(version!==epoch || request!==playbackEpoch || shown.id!==target.id)return;
      playback=result;
    }catch{
      if(version===epoch && request===playbackEpoch)
        playbackError="Informations techniques indisponibles pour ce média.";
    }finally{
      if(version===epoch && request===playbackEpoch)playbackBusy=false;
    }
  }
  function notifyPlaybackOnce(session:PlaybackReporter){
    if(playbackNotificationSent || !session.didStart)return;
    playbackNotificationSent=true;
    void session.drain().then(()=>{
      // Refresh only the signed-in user's authorized shelves. The server
      // remains the source of truth for progress and NextUp.
      if(api.session)onplaybackchange();
    }).catch(()=>{});
  }
  function stopStream(failed=false){
    const current=streamTicket;
    const finished=reporter;
    reporter=null;
    if(finished && videoElement){
      finished.stop(playbackClock(videoElement),failed);
      notifyPlaybackOnce(finished);
    }
    const player=hlsPlayer;
    hlsPlayer=null;
    player?.destroy();
    videoElement?.pause();
    if(videoElement){
      videoElement.removeAttribute("src");
      videoElement.load();
    }
    streamTicket=null;streamKind=null;
    streamBusy=false;streamStarted=false;
    if(current)void api.endNativePlayback(current.ticket).catch(()=>{});
  }
  async function startNativeVideo(){
    if(streamBusy || !nativeAvailable)return;
    const target=shown,version=epoch,request=++streamEpoch;
    stopStream();streamBusy=true;streamError="";reportWarning="";
    playbackNotificationSent=false;
    try{
      const probe=playback??await api.getPlaybackInfo(target.id);
      if(epoch!==version || request!==streamEpoch ||
        shown.id!==target.id)return;
      playback=probe;
      const direct=selectDirectMp4(probe);
      const hls=direct?null:selectJellyfinHls(probe);
      const source=direct??hls;
      if(!source?.id){
        streamError="Jellyfin ne propose ni lecture MP4 compatible "+
          "ni transcodage autorisé pour ce média.";
        return;
      }
      const mode=direct?"direct":"hls";
      const ticket=mode==="direct"
        ?await api.beginNativeDirectPlayback(target.id,source.id)
        :await api.beginNativeHlsPlayback(target.id,source.id);
      if(epoch!==version || request!==streamEpoch ||
        shown.id!==target.id){
        await api.endNativePlayback(ticket.ticket).catch(()=>{});
        return;
      }
      reporter=new PlaybackReporter({
        itemId:target.id,mediaSourceId:source.id,
        playSessionId:probe.playSessionId??null,
        playMethod:mode==="direct"?"DirectPlay":"Transcode"
      },(event)=>api.reportPlayback(event),()=>{
        reportWarning="Lecture possible, mais la synchronisation "+
          "de la progression avec Jellyfin a échoué.";
      });
      streamKind=mode;streamTicket=ticket;
      await tick();
      if(request!==streamEpoch || !videoElement)return;
      if(mode==="hls"){
        const {default:Hls}=await import("hls.js");
        if(request!==streamEpoch)return;
        if(!Hls.isSupported()){
          streamError="Le navigateur intégré ne prend pas en charge MSE/HLS.";
          stopStream();
          return;
        }
        const engine=new Hls({
          enableWorker:true,maxBufferLength:24,
          maxMaxBufferLength:48,maxBufferSize:48*1024*1024,
          manifestLoadingMaxRetry:2,
          levelLoadingMaxRetry:2,
          fragLoadingMaxRetry:2,
        });
        hlsPlayer=engine;
        engine.on(Hls.Events.MEDIA_ATTACHED,()=>{
          if(request===streamEpoch)engine.loadSource(ticket.url);
        });
        engine.on(Hls.Events.MANIFEST_PARSED,()=>{
          if(request===streamEpoch)
            void videoElement?.play().catch(()=>{});
        });
        engine.on(Hls.Events.ERROR,(_event,detail)=>{
          if(detail.fatal && request===streamEpoch){
            streamError="Lecture HLS interrompue. "+
              "Vérifiez l'accès au serveur et le transcodage Jellyfin.";
            streamEpoch++;stopStream(true);
          }
        });
        engine.attachMedia(videoElement);
      }else{
        try{await videoElement.play();}
        catch{/* Autoplay may be denied; native controls stay visible. */}
      }
    }catch{
      if(epoch===version && request===streamEpoch)
        streamError="Lecture impossible. Vérifiez le format et l'accès à Jellyfin.";
    }finally{
      if(epoch===version && request===streamEpoch)streamBusy=false;
    }
  }
  function handleKey(event:KeyboardEvent){
    if(event.key==="Escape"){event.preventDefault();onclose();}
  }
</script>

<svelte:window onkeydown={handleKey} />
<div class="vy-detail-screen" role="presentation">
  <div class="vy-detail vy-detail-native" role="dialog" aria-modal="true"
    aria-label={"Fiche : "+item.title}>
    <button bind:this={closeButton} type="button" class="vy-detail-close"
      aria-label="Fermer" onclick={onclose}>×</button>
    <div class="vy-detail-top">
      {#if hasArtwork(shown)}
        <img alt="" use:lazyArtwork={{cache,item:shown,kind:"Backdrop" as const}} />
      {/if}
    </div>
    <div class="vy-detail-body">
      {#if focusedEpisode}
        <button class="vy-detail-back" type="button"
          onclick={()=>{streamEpoch++;stopStream();streamError="";
            focusedEpisode=null;playback=null;
            playbackBusy=false;playbackEpoch++;}}>
          ‹ Retour à {media?.title??item.title}
        </button>
      {/if}
      <h2>{shown.title}</h2>
      <p class="vy-detail-meta">
        {#if shown.type==="Episode"}{episodeLabel(shown)} · {/if}
        {shown.year??""}
        {#if duration(shown.runtimeTicks)} · {duration(shown.runtimeTicks)}{/if}
        {#if shown.communityRating!==null}
          · ★ {shown.communityRating.toFixed(1)}/10
        {/if}
        {#if shown.genres.length}
          · {shown.genres.slice(0,3).join(" · ")}
        {/if}
      </p>
      <p>{shown.overview || "Aucun synopsis disponible."}</p>
      <div class="vy-detail-controls" role="group" aria-label="Actions du média">
        <button type="button" class="vy-detail-control" class:active={isFavorite}
          aria-label={favoriteUnavailable?"Favori non vérifié":
            isFavorite?"Retirer de ma liste":"Ajouter à ma liste"}
          aria-pressed={isFavorite}
          disabled={stateBusy||favoriteUnavailable}
          onclick={()=>void mutateMedia("favorite")}>
          <VyIcon kind="heart" size={18}/>
          <span>{favoriteUnavailable?"Vérification du favori…":
            isFavorite?"Dans ma liste":"Ma liste"}</span>
        </button>
        <button type="button" class="vy-detail-control" class:active={shown.played}
          aria-label={shown.played?"Marquer non vu":"Marquer vu"}
          aria-pressed={shown.played} disabled={stateBusy}
          onclick={()=>void mutateMedia("played")}>
          <VyIcon kind="check" size={18}/>
          <span>{shown.played?"Déjà vu":"Marquer vu"}</span>
        </button>
      </div>
      {#if stateError}<p class="vy-detail-warning" role="alert">{stateError}</p>{/if}

      {#if item.type==="Series" && !focusedEpisode}
        <section class="vy-seasons" aria-label="Saisons et épisodes">
          <h3>Saisons et épisodes</h3>
          {#if seasonsLoading}
            <p class="vy-detail-muted">Chargement des saisons…</p>
          {:else if seasonsError}
            <p class="vy-detail-warning" role="status">{seasonsError}</p>
            <button type="button" class="vy-detail-action"
              onclick={()=>void hydrate()}>Réessayer</button>
          {:else if !seasons.length}
            <p class="vy-detail-muted">Aucune saison disponible pour ce compte.</p>
          {:else}
            <div class="vy-season-selector" role="group" aria-label="Choisir la saison">
              {#each seasons as season (season.id)}
                <button type="button" class:active={activeSeason===season.id}
                  onclick={()=>chooseSeason(season.id)}>
                  {season.title}
                  {#if season.episodeCount!==null}
                    <small>{season.episodeCount}</small>
                  {/if}
                </button>
              {/each}
            </div>
            <div class="vy-episodes">
              {#each episodes as episode (episode.id)}
                <button class="vy-episode" type="button"
                  onclick={()=>focusEpisode(episode)}
                  aria-label={"Détails épisode : "+episode.title}>
                  <span class="vy-episode-number">{episodeLabel(episode)}</span>
                  <span class="vy-episode-text">
                    <strong>{episode.title}</strong>
                    <small>{duration(episode.runtimeTicks)}
                      {#if episode.progress!==null && episode.progress>0}
                        · {episode.progress}% visionné
                      {/if}
                    </small>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              {/each}
            </div>
            {#if episodeError}<p class="vy-detail-warning" role="alert">{episodeError}</p>{/if}
            {#if nextOffset!==null}
              <button type="button" class="vy-detail-action"
                disabled={episodeLoading} onclick={()=>void loadEpisodes()}>
                {episodeLoading?"Chargement…":
                  episodeError?"Réessayer":"Afficher davantage d'épisodes"}
              </button>
            {/if}
            {#if !episodes.length && nextOffset===null}
              <p class="vy-detail-muted">Aucun épisode disponible.</p>
            {/if}
            {#if episodeTotal!==null}
              <p class="vy-detail-muted">{episodes.length} / {episodeTotal} épisodes</p>
            {/if}
          {/if}
        </section>
      {/if}

      {#if shown.type==="Movie" || shown.type==="Episode"}
        <section class="vy-playback-check" aria-label="Compatibilité du média">
          <h3>Lecture et qualité</h3>
          <p class="vy-detail-muted">
            Lecture directe MP4 compatible, sinon transcodage HLS via
            Jellyfin pour les médias distants, dont les fichiers STRM.
            Cette fonction est encore expérimentale.
          </p>
          {#if nativeAvailable}
            <div class="vy-direct-play-actions">
              <button type="button" class="vy-detail-action"
                disabled={streamBusy || playbackBusy}
                onclick={()=>void startNativeVideo()}>
                <VyIcon kind="play" size={17}/>
                {streamBusy?"Ouverture…":"Lire dans Vynéo"}
              </button>
              {#if streamTicket}
                <button type="button" class="vy-detail-action"
                  onclick={()=>{streamEpoch++;stopStream();}}>
                  Arrêter la lecture
                </button>
              {/if}
            </div>
          {/if}
          {#if streamError}
            <p class="vy-detail-warning" role="alert">{streamError}</p>
          {/if}
          {#if reportWarning}
            <p class="vy-detail-warning" role="status">{reportWarning}</p>
          {/if}
          {#if streamTicket}
            <div class="vy-native-player">
              <!-- svelte-ignore a11y_media_has_caption -->
              <video bind:this={videoElement}
                src={streamKind==="direct"?streamTicket.url:undefined}
                controls playsinline preload="metadata"
                aria-label={"Lecteur vidéo : "+shown.title}
                onplaying={()=>{
                  streamStarted=true;
                  if(reporter && videoElement)
                    reporter.playing(playbackClock(videoElement));
                }}
                ontimeupdate={()=>{
                  if(reporter && videoElement)
                    reporter.progress(playbackClock(videoElement));
                }}
                onpause={()=>{
                  if(reporter && videoElement)
                    reporter.pause(playbackClock(videoElement));
                }}
                onseeked={()=>{
                  if(reporter && videoElement)
                    reporter.progress(playbackClock(videoElement),true);
                }}
                onended={()=>{
                  if(reporter && videoElement){
                    reporter.ended(playbackClock(videoElement));
                    notifyPlaybackOnce(reporter);
                  }
                }}
                onloadedmetadata={()=>{
                  const seconds=resumeAtSeconds(shown,
                    videoElement?.duration??NaN);
                  if(seconds>0 && videoElement){
                    try{videoElement.currentTime=seconds;}
                    catch{/* Some remote streams cannot seek: start at zero. */}
                  }
                }}
                onerror={()=>{
                  // Clearing an intentional stop can emit a delayed WebView2
                  // media error. Ignore it once the capability is revoked.
                  if(!streamTicket)return;
                  streamError="Flux indisponible ou codec non pris en charge.";
                  if(reporter && videoElement)
                    reporter.stop(playbackClock(videoElement),true);
                  streamEpoch++;stopStream();
                }}></video>
              {#if !streamStarted}
                <p class="vy-detail-muted" role="status">
                  En attente de la première image. Utilisez Lecture si le
                  navigateur intégré bloque le démarrage automatique.
                </p>
              {/if}
            </div>
          {/if}
          <button type="button" class="vy-detail-action" disabled={playbackBusy}
            onclick={()=>void inspectPlayback()}>
            {playbackBusy?"Analyse en cours…":"Vérifier les formats disponibles"}
          </button>
          {#if playbackError}
            <p class="vy-detail-warning" role="alert">{playbackError}</p>
          {/if}
          {#if playback}
            {#if playback.errorCode}
              <p class="vy-detail-warning" role="status">
                Le serveur indique : {playback.errorCode}.
              </p>
            {/if}
            {#if !playback.sources.length}
              <p class="vy-detail-muted">Aucune source lisible annoncée par le serveur.</p>
            {/if}
            {#each playback.sources as source,index (index)}
              <div class="vy-source-summary">
                <div class="vy-source-heading">
                  <strong>{source.title}</strong>
                  <span>{source.container || "Format inconnu"} · {bitrate(source.bitrate)}</span>
                </div>
                <p class="vy-detail-muted">
                  Lecture directe annoncée : {source.directPlay?"oui":"non"}
                  · Flux direct : {source.directStream?"oui":"non"}
                  · Transcodage : {source.transcoding?"possible":"non annoncé"}
                </p>
                {#each ["Video","Audio","Subtitle"] as kind}
                  {@const tracks=source.tracks.filter(track=>track.kind===kind)}
                  {#if tracks.length}
                    <div class="vy-source-tracks">
                      <strong>{kind==="Video"?"Vidéo":kind==="Audio"?"Audio":"Sous-titres"}</strong>
                      {#each tracks as track (track.index)}
                        <span>
                          {track.title || [track.codec,track.language].filter(Boolean).join(" · ")}
                          {#if track.width && track.height}
                            · {track.width}×{track.height}
                          {/if}
                          {#if track.channels} · {track.channels} canaux{/if}
                          {#if track.isDefault} · défaut{/if}
                          {#if track.isExternal} · externe{/if}
                        </span>
                      {/each}
                    </div>
                  {/if}
                {/each}
              </div>
            {/each}
          {/if}
          <div class="vy-unavailable">
            {nativeAvailable
              ?"Version expérimentale : HLS utilise le transcodage Jellyfin. Le suivi de progression, les sous-titres et la qualité automatique restent à valider avant publication stable."
              :"La lecture intégrée nécessite la version native Tauri. Ce diagnostic seul ne lance aucune lecture."}
          </div>
        </section>
      {:else if item.type==="Series"}
        <div class="vy-unavailable">
          Choisissez un épisode pour vérifier ses pistes vidéo, audio et sous-titres.
          Le lecteur expérimental apparaît après sélection d'un épisode
          dans l'application native.
        </div>
      {/if}
    </div>
  </div>
</div>
