<script lang="ts">
  import {onMount,tick} from "svelte";
  import {isTauri} from "@tauri-apps/api/core";
  import {selectDirectMp4,selectJellyfinHls,resumeAtSeconds,
    playbackDurationSeconds} from "./native-playback";
  import {capturePlaybackSwitch,shouldAutoplayAfterSwitch}
    from "./playback-switch";
  import type Hls from "hls.js";
  import {initialHlsFragmentPolicy,firstFragmentReceived,
    fragmentReachesResumePosition} from "./hls-load-policy";
  import type {NativeStreamTicket} from "./native-playback";
  import {PlaybackReporter,playbackClock} from "./playback-report";
  import {unavailablePlaybackMessage,nativeHlsFailureMessage,
    htmlVideoFailureMessage,playbackInspectionErrorMessage} from "./playback-errors";
  import type {JellyfinApi} from "./api";
  import type {MediaAction} from "./media-actions";
  import VyIcon from "./VyIcon.svelte";
  import type {ArtworkCache} from "./artwork";
  import {hasArtwork,lazyArtwork} from "./artwork";
  import type {EpisodePage,MediaItem,PlaybackProbe,PlaybackSource,SeasonSummary}
    from "./types";
  import {displayTrack,graphicSubtitleIndex,hasTrack,selectableTracks}
    from "./playback-tracks";

  type Props={
    item:MediaItem;
    api:JellyfinApi;
    cache:ArtworkCache;
    onaction:(item:MediaItem,action:MediaAction)=>Promise<boolean>;
    onclose:()=>void;
    onplaybackchange:()=>void;
    qaReadOnly?:boolean;
  };
  let {item,api,cache,onaction,onclose,onplaybackchange,
    qaReadOnly=false}:Props=$props();
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
  let streamRuntimeTicks:number|null=null;
  let sourceInUse=$state<PlaybackSource|null>(null);
  let selectedAudioIndex=$state<number|null>(null);
  let selectedSubtitleIndex=$state<number|null>(null);
  let burnedSubtitleIndex=$state<number|null>(null);
  let subtitleBlobUrl=$state<string|null>(null);
  let subtitleLoading=$state(false);
  let subtitleError=$state("");
  let subtitleEpoch=0;
  let subtitleAbort:AbortController|null=null;
  let retainedSeekSeconds:number|null=null;
  let retainedVolume:number|null=null;
  let retainedMuted:boolean|null=null;
  let retainedPaused:boolean|null=null;
  let resumeApplied=false;
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
  let tracksSource=$derived(sourceInUse??playback?.sources.find(source=>
    source.id!==null)??null);
  let audioTracks=$derived(selectableTracks(tracksSource,"Audio"));
  let subtitleTracks=$derived(selectableTracks(tracksSource,"Subtitle"));
  let unsupportedSubtitles=$derived(tracksSource?.tracks.some(track=>
    track.kind==="Subtitle" && !subtitleTracks.some(other=>
      other.index===track.index))??false);
  let graphicalSubtitles=$derived(subtitleTracks.some(track=>
    graphicSubtitleIndex(tracksSource,track.index)));
  let activeSubtitle=$derived(subtitleTracks.find(track=>
    track.index===selectedSubtitleIndex)??null);
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
    streamEpoch++;stopStream();resetTrackSelection();streamError="";
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
    streamEpoch++;stopStream();resetTrackSelection();streamError="";
    focusedEpisode=episode;playback=null;playbackError="";
    playbackBusy=false;playbackEpoch++;stateError="";
  }
  async function mutateMedia(action:MediaAction){
    if(qaReadOnly || stateBusy ||
       (action==="favorite" && favoriteUnavailable))return;
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
    }catch(error){
      if(version===epoch && request===playbackEpoch)
        playbackError=playbackInspectionErrorMessage(error);
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
  function applySavedResume(){
    if(resumeApplied || !videoElement || videoElement.readyState<1)return;
    const total=playbackDurationSeconds(
      videoElement.duration,streamRuntimeTicks);
    const seconds=retainedSeekSeconds??
      resumeAtSeconds(shown,total);
    if(seconds<=0)return;
    // HLS MSE may not expose its seekable range at loadedmetadata yet.
    // Recheck at durationchange/canplay rather than silently losing resume.
    const ranges=videoElement.seekable;
    let available=streamKind==="direct";
    for(let i=0;i<ranges.length;i++){
      if(seconds>=ranges.start(i) && seconds<=ranges.end(i))
        available=true;
    }
    if(!available)return;
    try{
      videoElement.currentTime=seconds;
      resumeApplied=true;
      retainedSeekSeconds=null;
    }catch{/* Reattempt when another seekable range becomes available. */}
  }
  function clearSubtitleBlob(){
    subtitleEpoch++;
    subtitleAbort?.abort();
    subtitleAbort=null;
    const old=subtitleBlobUrl;
    subtitleBlobUrl=null;
    subtitleLoading=false;
    // Remove any previous text track before switching source or language.
    if(videoElement){
      for(let i=0;i<videoElement.textTracks.length;i++)
        videoElement.textTracks[i].mode="disabled";
    }
    if(old)URL.revokeObjectURL(old);
  }
  function resetTrackSelection(){
    selectedAudioIndex=null;selectedSubtitleIndex=null;
    retainedSeekSeconds=null;retainedVolume=null;retainedMuted=null;
    retainedPaused=null;burnedSubtitleIndex=null;
    sourceInUse=null;subtitleError="";
    clearSubtitleBlob();
  }
  async function loadSelectedSubtitle(){
    const source=sourceInUse,index=selectedSubtitleIndex;
    clearSubtitleBlob();subtitleError="";
    if(index===null || !streamTicket || !source?.id)return;
    if(!hasTrack(source,"Subtitle",index)){
      selectedSubtitleIndex=null;
      return;
    }
    // Bitmap subtitles are already composited by Jellyfin's transcoder.
    // Never request their raw stream as text or create a <track> element.
    if(graphicSubtitleIndex(source,index))return;
    const request=subtitleEpoch,version=epoch,target=shown.id;
    const controller=new AbortController();
    subtitleAbort=controller;subtitleLoading=true;
    try{
      const vtt=await api.getSubtitleVtt(target,source.id,index,
        controller.signal);
      if(request!==subtitleEpoch || version!==epoch ||
         shown.id!==target || !streamTicket)return;
      subtitleBlobUrl=URL.createObjectURL(new Blob([vtt],{
        type:"text/vtt;charset=utf-8"
      }));
    }catch{
      if(request===subtitleEpoch && version===epoch)
        subtitleError="Sous-titres momentanément indisponibles pour cette piste.";
    }finally{
      if(subtitleAbort===controller)subtitleAbort=null;
      if(request===subtitleEpoch)subtitleLoading=false;
    }
  }
  function restartStreamPreservingState(){
    const previousSource=sourceInUse?.id??tracksSource?.id;
    const snapshot=capturePlaybackSwitch(videoElement);
    retainedSeekSeconds=snapshot.seekSeconds;
    retainedVolume=snapshot.volume;
    retainedMuted=snapshot.muted;
    retainedPaused=snapshot.paused;
    streamEpoch++;
    stopStream();
    void startNativeVideo(previousSource);
  }
  async function chooseSubtitle(value:string){
    if(streamBusy)return;
    const index=value==="off"?null:Number(value);
    if(index!==null && !hasTrack(tracksSource,"Subtitle",index)){
      subtitleError="Piste de sous-titres non disponible.";
      return;
    }
    if(index===selectedSubtitleIndex)return;
    const switchBurnIn=burnedSubtitleIndex!==null ||
      graphicSubtitleIndex(tracksSource,index);
    selectedSubtitleIndex=index;
    if(streamTicket && switchBurnIn){
      restartStreamPreservingState();
      return;
    }
    await loadSelectedSubtitle();
  }
  function chooseAudio(value:string){
    const index=value==="auto"?null:Number(value);
    if(index!==null && !hasTrack(tracksSource,"Audio",index)){
      streamError="Piste audio non disponible.";
      return;
    }
    if(streamBusy || index===selectedAudioIndex)return;
    selectedAudioIndex=index;
    if(streamTicket)restartStreamPreservingState();
  }
  function stopStream(failed=false){
    clearSubtitleBlob();
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
    streamTicket=null;streamKind=null;streamRuntimeTicks=null;
    sourceInUse=null;burnedSubtitleIndex=null;resumeApplied=false;
    streamBusy=false;streamStarted=false;
    if(current)void api.endNativePlayback(current.ticket).catch(()=>{});
  }
  async function startNativeVideo(preferredSourceId?:string|null){
    if(streamBusy || !nativeAvailable)return;
    if(!preferredSourceId){
      retainedSeekSeconds=null;retainedVolume=null;retainedMuted=null;
      retainedPaused=null;
    }
    const target=shown,version=epoch,request=++streamEpoch;
    // Remember the source before stopStream discards its old capability.
    let selectedSource=preferredSourceId??tracksSource?.id??null;
    const graphicIndex=selectedSubtitleIndex!==null &&
      graphicSubtitleIndex(tracksSource,selectedSubtitleIndex)
        ?selectedSubtitleIndex:null;
    stopStream();streamBusy=true;streamError="";reportWarning="";
    playbackNotificationSent=false;
    try{
      // A fresh player may not yet have inspected the item's versions.
      // Resolve the source first, then ALWAYS pin it with SubtitleStreamIndex
      // -1. Otherwise Jellyfin can silently choose its default subtitle
      // and spend minutes extracting it before the first HLS fragment.
      if(!selectedSource){
        const inspection=await api.getPlaybackInfo(target.id);
        if(epoch!==version || request!==streamEpoch ||
           shown.id!==target.id)return;
        selectedSource=inspection.sources.find(source=>source.id)?.id??null;
      }
      if(!selectedSource)throw new Error("TRACK_SOURCE_UNAVAILABLE");
      const negotiation=await api.negotiatePlaybackInfo(target.id,{
        mediaSourceId:selectedSource,
        ...(selectedAudioIndex!==null?
          {audioStreamIndex:selectedAudioIndex}:{}),
        ...(graphicIndex!==null?
          {graphicSubtitleIndex:graphicIndex}:{})
      });
      if(epoch!==version || request!==streamEpoch ||
        shown.id!==target.id)return;
      const probe=negotiation.probe;
      playback=probe;
      // The negotiated source is fixed even for automatic audio, so
      // Jellyfin cannot reselect another version or default subtitles.
      const candidates=probe.sources.filter(source=>
        source.id===selectedSource);
      const direct=selectedAudioIndex===null && graphicIndex===null?
        selectDirectMp4({...probe,sources:candidates}):null;
      const hls=direct?null:selectJellyfinHls({
        ...probe,sources:candidates.filter(source=>
          source.id && negotiation.hlsPaths[source.id])
      });
      const source=direct??hls;
      if(!source?.id){
        streamError=unavailablePlaybackMessage(probe);
        return;
      }
      const mode=direct?"direct":"hls";
      const ticket=mode==="direct"
        ?await api.beginNativeDirectPlayback(target.id,source.id)
        :await api.beginNativeHlsPlayback(target.id,source.id,
          negotiation.hlsPaths[source.id]);
      if(epoch!==version || request!==streamEpoch ||
        shown.id!==target.id){
        await api.endNativePlayback(ticket.ticket).catch(()=>{});
        return;
      }
      if(!qaReadOnly){
        reporter=new PlaybackReporter({
          itemId:target.id,mediaSourceId:source.id,
          playSessionId:probe.playSessionId??null,
          playMethod:mode==="direct"?"DirectPlay":
            !source.transcoding && source.directStream?"DirectStream":"Transcode"
        },(event)=>api.reportPlayback(event),()=>{
          reportWarning="Lecture possible, mais la synchronisation "+
            "de la progression avec Jellyfin a échoué.";
        });
      }
      streamKind=mode;streamTicket=ticket;sourceInUse=source;
      burnedSubtitleIndex=graphicIndex;
      if(selectedSubtitleIndex!==null &&
         !hasTrack(source,"Subtitle",selectedSubtitleIndex))
        selectedSubtitleIndex=null;
      if(selectedSubtitleIndex!==null)
        void loadSelectedSubtitle();
      streamRuntimeTicks=source.runtimeTicks;
      resumeApplied=false;
      await tick();
      if(request!==streamEpoch)return;
      if(!videoElement){
        streamError="Le lecteur vidéo n'a pas pu être initialisé.";
        stopStream(true);
        return;
      }
      if(retainedVolume!==null){
        videoElement.volume=retainedVolume;
        retainedVolume=null;
      }
      if(retainedMuted!==null){
        videoElement.muted=retainedMuted;
        retainedMuted=null;
      }
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
          fragLoadPolicy:initialHlsFragmentPolicy(),
        });
        hlsPlayer=engine;
        // A resumed audio/subtitle switch can first load 0.ts and then
        // seek to 4m25s. The distant fragment can take more than the
        // warm 12s budget even if Jellyfin returns 200 eventually.
        // Do not shorten the fragment deadline until THAT fragment
        // has arrived, otherwise a valid remote STRM falsely times out.
        const resumeFragmentTarget=retainedSeekSeconds;
        engine.on(Hls.Events.FRAG_LOADED,(_event,data)=>{
          if(request===streamEpoch &&
             fragmentReachesResumePosition(
               resumeFragmentTarget,data.frag.start,data.frag.duration)){
            const loading=data.frag.stats.loading;
            const firstByteMs=loading && Number.isFinite(loading.first) &&
              Number.isFinite(loading.start)
              ?loading.first-loading.start:0;
            firstFragmentReceived(engine.config.fragLoadPolicy,firstByteMs);
          }
        });
        engine.on(Hls.Events.MEDIA_ATTACHED,()=>{
          if(request===streamEpoch)engine.loadSource(ticket.url);
        });
        engine.on(Hls.Events.MANIFEST_PARSED,()=>{
          // Switching tracks must not unpause a movie the user paused.
          if(request===streamEpoch &&
             shouldAutoplayAfterSwitch(retainedPaused))
            void videoElement?.play().catch(()=>{});
        });
        engine.on(Hls.Events.ERROR,(_event,detail)=>{
          if(detail.fatal && request===streamEpoch){
            streamError=nativeHlsFailureMessage(detail.type,detail.details);
            streamEpoch++;stopStream(true);
          }
        });
        engine.attachMedia(videoElement);
      }else if(shouldAutoplayAfterSwitch(retainedPaused)){
        try{await videoElement.play();}
        catch{/* Autoplay may be denied; native controls stay visible. */}
      }
    }catch(error){
      if(epoch===version && request===streamEpoch){
        streamError=error instanceof Error &&
          error.message==="SUBTITLE_AUTO_BURN_UNAVAILABLE"
          ?"Jellyfin tente d'incruster un sous-titre non demandé. "+
            "La lecture a été refusée pour éviter ce transcodage."
          :error instanceof Error &&
          error.message==="AUDIO_TRACK_UNAVAILABLE"
          ?"Jellyfin ne peut pas sélectionner cette piste audio."
          :error instanceof Error &&
            error.message==="SUBTITLE_BURNIN_UNAVAILABLE"
            ?"Jellyfin ne peut pas incruster cette piste graphique."
          :"Lecture impossible. Vérifiez le format et l'accès à Jellyfin.";
        // A rejected dynamic HLS import or WebView2 initialization must
        // never leave a valid server-media capability in memory.
        stopStream(true);
      }
    }finally{
      // For HLS, keep "Ouverture" active until the first decodable data
      // arrives; otherwise the user can accidentally start two transcodes.
      if(epoch===version && request===streamEpoch && streamKind!=="hls")
        streamBusy=false;
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
            focusedEpisode=null;resetTrackSelection();playback=null;
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
          disabled={qaReadOnly||stateBusy||favoriteUnavailable}
          onclick={()=>void mutateMedia("favorite")}>
          <VyIcon kind="heart" size={18}/>
          <span>{favoriteUnavailable?"Vérification du favori…":
            isFavorite?"Dans ma liste":"Ma liste"}</span>
        </button>
        <button type="button" class="vy-detail-control" class:active={shown.played}
          aria-label={shown.played?"Marquer non vu":"Marquer vu"}
          aria-pressed={shown.played} disabled={qaReadOnly||stateBusy}
          onclick={()=>void mutateMedia("played")}>
          <VyIcon kind="check" size={18}/>
          <span>{shown.played?"Déjà vu":"Marquer vu"}</span>
        </button>
      </div>
      {#if qaReadOnly}
        <p class="vy-detail-muted" role="status">
          QA lecture seule : les favoris, l'état vu et la progression
          Jellyfin ne seront pas modifiés par ce lecteur temporaire.
        </p>
      {/if}
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
                  onclick={()=>{
                    streamEpoch++;retainedSeekSeconds=null;
                    retainedVolume=null;retainedMuted=null;
                    retainedPaused=null;stopStream();
                  }}>
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
                  // Once resumed by the user, discard the prior pause intent.
                  retainedPaused=null;
                  streamStarted=true;streamBusy=false;
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
                onloadedmetadata={applySavedResume}
                ondurationchange={applySavedResume}
                oncanplay={()=>{
                  applySavedResume();
                  if(streamKind==="hls")streamBusy=false;
                }}
                onerror={()=>{
                  // Clearing an intentional stop can emit a delayed WebView2
                  // media error. Ignore it once the capability is revoked.
                  if(!streamTicket)return;
                  streamError=htmlVideoFailureMessage(
                    videoElement?.error?.code??null);
                  if(reporter && videoElement)
                    reporter.stop(playbackClock(videoElement),true);
                  streamEpoch++;stopStream();
                }}>
                {#if subtitleBlobUrl && activeSubtitle}
                  <track kind="subtitles" src={subtitleBlobUrl}
                    srclang={activeSubtitle.language || "und"}
                    label={displayTrack(activeSubtitle)} default
                    onload={(event)=>{
                      (event.currentTarget as HTMLTrackElement).track.mode="showing";
                    }}/>
                {/if}
              </video>
              {#if !streamStarted}
                <p class="vy-detail-muted" role="status">
                  {streamKind==="hls" && streamBusy
                    ?"Jellyfin prépare le flux et les sous-titres. Le premier démarrage d’un fichier STRM peut prendre plusieurs dizaines de secondes."
                    :"En attente de la première image. Utilisez Lecture si le navigateur intégré bloque le démarrage automatique."}
                </p>
              {/if}
            </div>
          {/if}
          {#if nativeAvailable && tracksSource}
            <div class="vy-playback-track-controls"
              aria-label="Langues et sous-titres">
              {#if audioTracks.length>0}
                <label>
                  <span>Langue audio</span>
                  <select value={selectedAudioIndex===null?"auto":String(selectedAudioIndex)}
                    disabled={streamBusy || playbackBusy}
                    onchange={(event)=>chooseAudio(event.currentTarget.value)}>
                    <option value="auto">Automatique (Jellyfin)</option>
                    {#each audioTracks as track (track.index)}
                      <option value={String(track.index)}>
                        {displayTrack(track)}
                      </option>
                    {/each}
                  </select>
                </label>
              {/if}
              {#if subtitleTracks.length>0 || unsupportedSubtitles}
                <label>
                  <span>Sous-titres</span>
                  <select value={selectedSubtitleIndex===null?"off":String(selectedSubtitleIndex)}
                    disabled={streamBusy || playbackBusy}
                    onchange={(event)=>void chooseSubtitle(event.currentTarget.value)}>
                    <option value="off">Désactivés</option>
                    {#each subtitleTracks as track (track.index)}
                      <option value={String(track.index)}>
                        {displayTrack(track)}
                      </option>
                    {/each}
                  </select>
                </label>
                {#if graphicalSubtitles}
                  <p class="vy-detail-muted">
                    Les sous-titres graphiques utilisent une incrustation
                    vidéo Jellyfin : transcodage plus lourd, démarrage
                    potentiellement plus lent.
                  </p>
                {/if}
                {#if unsupportedSubtitles}
                  <p class="vy-detail-muted">
                    Certains formats de sous-titres ne sont pas pris en
                    charge par ce lecteur.
                  </p>
                {/if}
                {#if subtitleLoading}
                  <p class="vy-detail-muted" role="status">
                    Extraction des sous-titres Jellyfin en cours. Sur certains
                    fichiers distants, elle peut prendre plus d'une minute.
                    Vous pouvez choisir « Désactivés » pour annuler.
                  </p>
                {/if}
                {#if subtitleError}
                  <p class="vy-detail-warning" role="status">{subtitleError}</p>
                  {#if selectedSubtitleIndex!==null &&
                    !graphicSubtitleIndex(tracksSource,selectedSubtitleIndex)}
                    <button type="button" class="vy-detail-action"
                      disabled={subtitleLoading || streamBusy}
                      onclick={()=>void loadSelectedSubtitle()}>
                      Réessayer les sous-titres
                    </button>
                  {/if}
                {/if}
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
              ?"Préversion : pistes audio et sous-titres disponibles. L'incrustation graphique coûte davantage de ressources ; synchronisation et qualité automatique restent à valider avant publication stable."
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
