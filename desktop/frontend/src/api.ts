import type {MediaItem,MediaType,SessionPublic,CatalogKind,CatalogPage,CatalogLibraryIds,LibraryGroupKind,SeasonSummary,EpisodePage,PlaybackProbe} from "./types";
import {parseSeasons,parsePlaybackInfo} from "./media-details";
import type {RecentSeason} from "./new-seasons";
import type {TrendingRank} from "./trending";
import {candidateOffsets,CANDIDATE_BATCH_SIZE} from "./candidate-pages";

export const SERVER_ORIGIN="https://cocojellyfin.duckdns.org:38443";
const ID=/^[a-f0-9]{32}$/i;
const TOKEN=/^[a-z0-9._\-]{12,2048}$/i;
const TYPES=new Set<MediaType>(["Movie","Series","Episode","BoxSet","Playlist"]);
const FIELDS="Overview,Genres,Tags,Studios,CommunityRating,DateCreated,PremiereDate,UserData,ImageTags,BackdropImageTags,ProviderIds,ChildCount,RunTimeTicks";
const obj=(v:unknown):Record<string,unknown>=>
  v && typeof v==="object" && !Array.isArray(v)
    ?v as Record<string,unknown>:{};
const string=(v:unknown,max=500):string=>
  typeof v==="string"?v.slice(0,max):"";
const validId=(v:unknown):v is string=>
  typeof v==="string" && ID.test(v);
const collectionIds=(value:unknown):string[]=>
  typeof value==="string"
    ?[...new Set(value.split(/[;\s]+/).filter(id=>/^\d{1,16}$/.test(id)))].slice(0,12)
    :[];

export function normalizeItem(v:unknown):MediaItem|null {
  const row=obj(v),id=row.Id,type=row.Type;
  if(!validId(id) || !TYPES.has(type as MediaType) ||
     typeof row.Name!=="string" || !row.Name.trim())return null;
  const ud=obj(row.UserData),imageTags=obj(row.ImageTags);
  const providers=obj(row.ProviderIds);
  const duration=typeof row.RunTimeTicks==="number"?row.RunTimeTicks:0;
  const position=typeof ud.PlaybackPositionTicks==="number"
    ?ud.PlaybackPositionTicks:0;
  const score=typeof row.CommunityRating==="number" &&
    row.CommunityRating>=0 && row.CommunityRating<=10
    ?row.CommunityRating:null;
  return {
    id,title:string(row.Name,180),type:type as MediaType,
    year:typeof row.ProductionYear==="number" &&
      row.ProductionYear>1880 && row.ProductionYear<2200
      ?Math.floor(row.ProductionYear):null,
    overview:string(row.Overview,1600),
    genres:Array.isArray(row.Genres)
      ?row.Genres.filter((g):g is string=>typeof g==="string")
        .slice(0,12).map(g=>g.slice(0,70)):[],
    tags:Array.isArray(row.Tags)?row.Tags.filter((t):t is string=>typeof t==="string").slice(0,15).map(t=>t.slice(0,70)):[],
    studios:Array.isArray(row.Studios)?row.Studios.map(s=>string(obj(s).Name,70)).filter(Boolean).slice(0,5):[],
    communityRating:score,
    isFavorite:ud.IsFavorite===true,
    played:ud.Played===true,
    progress:duration>0 && position>0
      ?Math.max(0,Math.min(100,Math.round(position/duration*100))):null,
    // DateCreated is an import date, never evidence of a new release.
    premiereDate:string(row.PremiereDate,32),
    hasPrimary:typeof imageTags.Primary==="string",
    hasBackdrop:Array.isArray(row.BackdropImageTags) &&
      row.BackdropImageTags.length>0,
    hasThumb:typeof imageTags.Thumb==="string",
    parentBackdropItemId:validId(row.ParentBackdropItemId)
      ?row.ParentBackdropItemId:null,
    hasParentBackdrop:Array.isArray(row.ParentBackdropImageTags) &&
      row.ParentBackdropImageTags.length>0,
    seriesId:validId(row.SeriesId)?row.SeriesId:null,
    seasonId:validId(row.SeasonId)?row.SeasonId:null,
    playedPercentage:typeof ud.PlayedPercentage==="number" &&
      Number.isFinite(ud.PlayedPercentage) &&
      ud.PlayedPercentage>=0 && ud.PlayedPercentage<=100
      ?ud.PlayedPercentage:null,
    franchiseId:collectionIds(providers.TmdbCollection)[0]??null,
    tmdbId:collectionIds(providers.Tmdb)[0]??null,
    // TVDb often stores multiple collection IDs joined by ';'. These
    // group spin-offs (including TV series), but also editorial lists:
    // classification must verify a shared dominant tag before using them.
    tvdbCollectionIds:collectionIds(providers.TvdbCollection),
    seasonNumber:typeof row.ParentIndexNumber==="number" &&
      Number.isSafeInteger(row.ParentIndexNumber) &&
      row.ParentIndexNumber>=0 && row.ParentIndexNumber<=1000
      ?row.ParentIndexNumber:null,
    episodeNumber:typeof row.IndexNumber==="number" &&
      Number.isSafeInteger(row.IndexNumber) &&
      row.IndexNumber>=0 && row.IndexNumber<=10000
      ?row.IndexNumber:null,
    runtimeTicks:typeof row.RunTimeTicks==="number" &&
      Number.isSafeInteger(row.RunTimeTicks) &&
      row.RunTimeTicks>0?row.RunTimeTicks:null,
    seasonCount:typeof row.ChildCount==="number" &&
      Number.isSafeInteger(row.ChildCount) &&
      row.ChildCount>=0 && row.ChildCount<=1000?row.ChildCount:null,
    seriesName:string(row.SeriesName,120)
  };
}
export function parseItems(payload:unknown,limit:number):MediaItem[]{
  const data=obj(payload);
  if(!Array.isArray(data.Items))throw new Error("CATALOG_INVALID");
  const seen=new Set<string>(),items:MediaItem[]=[];
  for(const row of data.Items.slice(0,Math.min(limit,300))){
    const item=normalizeItem(row);
    if(item && !seen.has(item.id)){seen.add(item.id);items.push(item);}
  }
  return items;
}
// Use the library folders the signed-in Jellyfin user can actually access.
// "Anime" and "Animation" are NOT interchangeable categories.
export function resolveCatalogLibraryIds(payload:unknown):CatalogLibraryIds {
  const views=obj(payload).Items;
  if(!Array.isArray(views))throw new Error("LIBRARIES_INVALID");
  const ids:CatalogLibraryIds={Movie:null,Series:null,Anime:null};
  for(const view of views.slice(0,100)){
    const row=obj(view);
    if(!validId(row.Id) || typeof row.Name!=="string" ||
       !["movies","tvshows"].includes(String(row.CollectionType)))continue;
    const label=row.Name.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .trim().toLowerCase().replace(/\s+/g," ");
    let kind:CatalogKind|null=null;
    if(/^(?:anime|animes)$/.test(label))kind="Anime";
    else if(row.CollectionType==="movies" && /^(?:films?|movies?)$/.test(label))
      kind="Movie";
    else if(row.CollectionType==="tvshows" && /^(?:series?|tv shows?)$/.test(label))
      kind="Series";
    if(kind && !ids[kind])ids[kind]=row.Id;
  }
  return ids;
}
function identityHeaders(token:string|null,deviceId:string):
    Record<string,string>{
  const auth='MediaBrowser Client="Vyneo", Device="Vyneo Desktop", '+
    'DeviceId="'+deviceId+'", Version="0.2.4"';
  return {
    Accept:"application/json",
    Authorization:token?auth+', Token="'+token+'"':auth
  };
}
export interface ApiOptions{
  fetcher?:typeof fetch;
  deviceId?:string;
  origin?:string;
}
export class JellyfinApi {
  private authGeneration=0;
  private libraryRoots:Promise<CatalogLibraryIds>|null=null;
  private token:string|null=null;
  private userId:string|null=null;
  private username:string|null=null;
  private readonly fetcher:typeof fetch;
  private readonly deviceId:string;
  private readonly origin:string;
  constructor(opts:ApiOptions={}){
    // Never connect to an arbitrary host (or copy auth tokens into a URL).
    if(opts.origin && opts.origin!==SERVER_ORIGIN)
      throw new Error("SERVER_ORIGIN_DENIED");
    this.origin=SERVER_ORIGIN;
    this.fetcher=opts.fetcher??fetch.bind(globalThis);
    const deviceId=opts.deviceId??"vyneo-desktop-local";
    if(!/^[a-z0-9-]{5,80}$/i.test(deviceId))
      throw new Error("DEVICE_ID_INVALID");
    this.deviceId=deviceId;
  }
  get session():SessionPublic|null {
    return this.userId && this.username
      ?{userId:this.userId,username:this.username}:null;
  }
  logout(){
    this.authGeneration++;
    this.libraryRoots=null;
    this.token=null;this.userId=null;this.username=null;
  }
  private async json(path:string,options:{
    method?:"GET"|"POST";
    body?:unknown;
    token?:string|null;
    maxBytes?:number;
    timeoutMs?:number;
  }={}):Promise<unknown>{
    if(!path.startsWith("/") || path.startsWith("//"))
      throw new Error("PATH_DENIED");
    const url=new URL(path,this.origin);
    if(url.origin!==this.origin || url.username || url.password ||
       url.hash)throw new Error("URL_DENIED");
    const headers=identityHeaders(
      options.token===undefined?this.token:options.token,
      this.deviceId
    );
    if(options.method==="POST")headers["Content-Type"]="application/json";
    let response:Response;
    try{
      response=await this.fetcher(url,{
        method:options.method??"GET",headers,mode:"cors",
        credentials:"omit",cache:"no-store",redirect:"error",
        referrerPolicy:"no-referrer",
        signal:AbortSignal.timeout(options.timeoutMs??12000),
        ...(options.method==="POST"?{body:JSON.stringify(options.body)}:{})
      });
    }catch{throw new Error("NETWORK_UNAVAILABLE");}
    if(!response.ok || response.redirected ||
       !(response.headers.get("Content-Type")??"")
         .toLowerCase().startsWith("application/json"))
      throw new Error(response.status===401?"SESSION_EXPIRED":"REQUEST_DENIED");
    const maxBytes=options.maxBytes??786432;
    const length=response.headers.get("Content-Length");
    if(length && Number(length)>maxBytes)throw new Error("RESPONSE_TOO_LARGE");
    const raw=await response.text();
    if(raw.length>maxBytes)throw new Error("RESPONSE_TOO_LARGE");
    try{return JSON.parse(raw);}catch{throw new Error("RESPONSE_INVALID");}
  }
  private requireUser():string{
    if(!this.token || !this.userId)throw new Error("AUTH_REQUIRED");
    return this.userId;
  }
  async login(username:string,password:string):Promise<SessionPublic>{
    this.logout();
    const generation=this.authGeneration;
    if(typeof username!=="string" || username.trim().length<1 ||
       username.length>96 || typeof password!=="string" ||
       password.length<1 || password.length>256)
      throw new Error("LOGIN_INVALID");
    const payload=obj(await this.json("/Users/AuthenticateByName",{
      method:"POST",body:{Username:username.trim(),Pw:password},
      token:null,maxBytes:98304
    }));
    if(generation!==this.authGeneration)throw new Error("LOGIN_CANCELLED");
    const user=obj(payload.User);
    if(!validId(user.Id) || typeof payload.AccessToken!=="string" ||
       !TOKEN.test(payload.AccessToken))
      throw new Error("LOGIN_INVALID");
    const accessToken=payload.AccessToken;
    // The self endpoint validates the authenticated identity independently.
    const me=obj(await this.json("/Users/Me",{
      token:accessToken,maxBytes:98304
    }));
    if(generation!==this.authGeneration)throw new Error("LOGIN_CANCELLED");
    if(me.Id!==user.Id || obj(me.Policy).IsDisabled===true)
      throw new Error("LOGIN_INVALID");
    this.userId=user.Id;this.token=accessToken;
    this.username=string(me.Name,96)||username.trim();
    return this.session!;
  }
  // Restore only after a fresh server-side /Users/Me validation. A
  // credential from another Jellyfin user can never be treated as logged-in.
  async restore(saved:{userId:string;accessToken:string}):Promise<SessionPublic>{
    this.logout();
    const generation=this.authGeneration;
    if(!validId(saved.userId) || !TOKEN.test(saved.accessToken))
      throw new Error("RESTORE_INVALID");
    const me=obj(await this.json("/Users/Me",{
      token:saved.accessToken,maxBytes:98304
    }));
    if(generation!==this.authGeneration)throw new Error("LOGIN_CANCELLED");
    if(me.Id!==saved.userId || obj(me.Policy).IsDisabled===true ||
       typeof me.Name!=="string" || !me.Name.trim())
      throw new Error("RESTORE_INVALID");
    this.userId=saved.userId;this.username=string(me.Name,96);
    this.token=saved.accessToken;
    return this.session!;
  }
  savedCredential():{userId:string;username:string;accessToken:string}|null{
    return this.userId && this.username && this.token?
      {userId:this.userId,username:this.username,accessToken:this.token}:null;
  }
  private async items(path:string,limit:number):Promise<MediaItem[]>{
    this.requireUser();
    return parseItems(await this.json(path,{maxBytes:1048576}),limit);
  }
  private userItems(params:Record<string,string|number>):string{
    const uid=this.requireUser();
    return "/Users/"+uid+"/Items?"+new URLSearchParams({
      Recursive:"true",EnableUserData:"true",Fields:FIELDS,
      StartIndex:"0",...Object.fromEntries(
        Object.entries(params).map(([k,v])=>[k,String(v)])
      )
    });
  }
  private async catalogLibraries():Promise<CatalogLibraryIds>{
    const uid=this.requireUser(),epoch=this.authGeneration;
    if(!this.libraryRoots){
      const pending=this.json("/Users/"+uid+"/Views",{maxBytes:262144})
        .then(resolveCatalogLibraryIds);
      this.libraryRoots=pending;
      // A transient failure must be retryable without re-using old results.
      void pending.catch(()=>{
        if(this.libraryRoots===pending)this.libraryRoots=null;
      });
    }
    const roots=await this.libraryRoots;
    if(epoch!==this.authGeneration || this.userId!==uid)
      throw new Error("SESSION_CHANGED");
    return roots;
  }
  async getFavoritePage(type:CatalogKind,startIndex=0,limit=48):Promise<CatalogPage>{
    return this.getCatalogPage(type,startIndex,limit,true);
  }
  async getCatalogPage(type:CatalogKind,startIndex=0,limit=48,
                       favorites=false):Promise<CatalogPage>{
    if((type!=="Movie" && type!=="Series" && type!=="Anime") ||
      !Number.isSafeInteger(startIndex) || startIndex<0 || startIndex>100000 ||
      !Number.isSafeInteger(limit) || limit<1 || limit>60)
      throw new Error("PAGE_INVALID");
    const roots=await this.catalogLibraries();
    const parentId=roots[type];
    if(!parentId)return {items:[],nextOffset:null,total:0,libraryAvailable:false};
    const params:Record<string,string|number>={
      ParentId:parentId,
      IncludeItemTypes:type==="Anime"?"Movie,Series":type,
      SortBy:"SortName",
      SortOrder:"Ascending",StartIndex:startIndex,Limit:limit,
      EnableTotalRecordCount:"true"
    };
    if(favorites)params.Filters="IsFavorite";
    const raw=obj(await this.json(this.userItems(params),
      {maxBytes:1048576}));
    if(!Array.isArray(raw.Items))throw new Error("CATALOG_INVALID");
    const items=parseItems(raw,limit).filter(item=>
      type==="Anime"?item.type==="Movie" || item.type==="Series":item.type===type);
    // Advance by raw records, not by validated cards: an invalid entry
    // must never cause a duplicate page or an endless retry.
    const consumed=Math.min(raw.Items.length,limit);
    const total=typeof raw.TotalRecordCount==="number" &&
      Number.isSafeInteger(raw.TotalRecordCount) && raw.TotalRecordCount>=0
      ?raw.TotalRecordCount:null;
    const more=consumed>0 && (total===null
      ?consumed===limit:startIndex+consumed<total);
    return {items,total,nextOffset:more?startIndex+consumed:null,libraryAvailable:true};
  }
  /** Page through collections or playlists *visible to this account*.
   * A navigation entry is not evidence of cross-library permission. */
  async getLibraryGroupPage(kind:LibraryGroupKind,
    startIndex=0,limit=48):Promise<CatalogPage>{
    if(!["BoxSet","Playlist"].includes(kind) ||
      !Number.isSafeInteger(startIndex) || startIndex<0 ||
      startIndex>100000 || !Number.isSafeInteger(limit) ||
      limit<1 || limit>60)throw new Error("PAGE_INVALID");
    const uid=this.requireUser(),generation=this.authGeneration;
    const path=this.userItems({IncludeItemTypes:kind,SortBy:"SortName",
      SortOrder:"Ascending",StartIndex:startIndex,Limit:limit,
      EnableTotalRecordCount:"true"});
    const raw=obj(await this.json(path,{maxBytes:1048576}));
    this.assertSession(uid,generation);
    if(!Array.isArray(raw.Items) || raw.Items.length>limit)
      throw new Error("GROUPS_INVALID");
    const consumed=raw.Items.length;
    const items=parseItems(raw,limit).filter(item=>item.type===kind);
    const total=typeof raw.TotalRecordCount==="number" &&
      Number.isSafeInteger(raw.TotalRecordCount) &&
      raw.TotalRecordCount>=0?raw.TotalRecordCount:null;
    const more=consumed>0 && (total===null
      ?consumed===limit:startIndex+consumed<total);
    return {items,total,nextOffset:more?startIndex+consumed:null,
      libraryAvailable:true};
  }
  /** Never infer collection membership from franchise tags or another user.
   * BoxSet children come from /Users/{id}/Items (ParentId scoped);
   * Playlist entries come from Jellyfin's documented Playlist API. */
  async getLibraryGroupContents(kind:LibraryGroupKind,id:string,
    startIndex=0,limit=48):Promise<CatalogPage>{
    if(!["BoxSet","Playlist"].includes(kind) || !validId(id) ||
      !Number.isSafeInteger(startIndex) || startIndex<0 ||
      startIndex>100000 || !Number.isSafeInteger(limit) ||
      limit<1 || limit>60)throw new Error("PAGE_INVALID");
    const uid=this.requireUser(),generation=this.authGeneration;
    const path=kind==="BoxSet"
      ?this.userItems({ParentId:id,Recursive:"false",
        IncludeItemTypes:"Movie,Series,Episode",
        SortBy:"SortName",SortOrder:"Ascending",
        StartIndex:startIndex,Limit:limit,EnableTotalRecordCount:"true"})
      :"/Playlists/"+id+"/Items?"+new URLSearchParams({
        userId:uid,StartIndex:String(startIndex),Limit:String(limit),
        Fields:FIELDS,EnableUserData:"true"
      });
    const raw=obj(await this.json(path,{maxBytes:1048576}));
    this.assertSession(uid,generation);
    if(!Array.isArray(raw.Items) || raw.Items.length>limit)
      throw new Error("GROUP_CONTENT_INVALID");
    const consumed=raw.Items.length;
    const items=parseItems(raw,limit).filter(item=>
      item.type==="Movie" || item.type==="Series" || item.type==="Episode");
    const total=typeof raw.TotalRecordCount==="number" &&
      Number.isSafeInteger(raw.TotalRecordCount) &&
      raw.TotalRecordCount>=0?raw.TotalRecordCount:null;
    const more=consumed>0 && (total===null
      ?consumed===limit:startIndex+consumed<total);
    return {items,total,nextOffset:more?startIndex+consumed:null,
      libraryAvailable:true};
  }
  private assertSession(uid:string,generation:number){
    if(generation!==this.authGeneration || this.userId!==uid)
      throw new Error("SESSION_CHANGED");
  }
  async getItemDetails(itemId:string):Promise<MediaItem>{
    const uid=this.requireUser(),generation=this.authGeneration;
    if(!validId(itemId))throw new Error("ITEM_INVALID");
    const raw=await this.json("/Users/"+uid+"/Items/"+itemId,{
      maxBytes:524288
    });
    this.assertSession(uid,generation);
    const media=normalizeItem(raw);
    if(!media || media.id.toLowerCase()!==itemId.toLowerCase())
      throw new Error("ITEM_INVALID");
    return media;
  }
  async getSeriesSeasons(seriesId:string):Promise<SeasonSummary[]>{
    const uid=this.requireUser(),generation=this.authGeneration;
    if(!validId(seriesId))throw new Error("SERIES_INVALID");
    const qs=new URLSearchParams({
      userId:uid,EnableUserData:"true",
      Fields:"Overview",EnableImages:"true"
    });
    const raw=await this.json("/Shows/"+seriesId+"/Seasons?"+qs,{
      maxBytes:524288
    });
    this.assertSession(uid,generation);
    return parseSeasons(raw);
  }
  async getSeasonEpisodes(seriesId:string,seasonId:string,
                          startIndex=0,limit=24):Promise<EpisodePage>{
    const uid=this.requireUser(),generation=this.authGeneration;
    if(!validId(seriesId) || !validId(seasonId) ||
       !Number.isSafeInteger(startIndex) || startIndex<0 || startIndex>100000 ||
       !Number.isSafeInteger(limit) || limit<1 || limit>40)
      throw new Error("EPISODES_INVALID");
    const qs=new URLSearchParams({
      userId:uid,seasonId,StartIndex:String(startIndex),
      Limit:String(limit),EnableUserData:"true",IsMissing:"false",
      Fields:"Overview,Genres,MediaStreams"
    });
    const raw=obj(await this.json("/Shows/"+seriesId+"/Episodes?"+qs,{
      maxBytes:786432
    }));
    this.assertSession(uid,generation);
    if(!Array.isArray(raw.Items))throw new Error("EPISODES_INVALID");
    const items=parseItems(raw,limit).filter(item=>
      item.type==="Episode" && (!item.seriesId ||
        item.seriesId.toLowerCase()===seriesId.toLowerCase()));
    const consumed=Math.min(raw.Items.length,limit);
    const total=typeof raw.TotalRecordCount==="number" &&
      Number.isSafeInteger(raw.TotalRecordCount) && raw.TotalRecordCount>=0
      ?raw.TotalRecordCount:null;
    const hasNext=consumed>0 && (total===null
      ?consumed===limit:startIndex+consumed<total);
    return {items,total,nextOffset:hasNext?startIndex+consumed:null};
  }
  async getPlaybackInfo(itemId:string):Promise<PlaybackProbe>{
    const uid=this.requireUser(),generation=this.authGeneration;
    if(!validId(itemId))throw new Error("PLAYBACK_ITEM_INVALID");
    // Read-only capability inspection. It must not start a playback session
    // or expose Jellyfin paths, stream URLs, secrets or transcode arguments.
    const qs=new URLSearchParams({userId:uid});
    const raw=await this.json("/Items/"+itemId+"/PlaybackInfo?"+qs,{
      maxBytes:786432
    });
    this.assertSession(uid,generation);
    return parsePlaybackInfo(raw);
  }
  async getUniverseCatalog():Promise<MediaItem[]>{
    const uid=this.requireUser(),generation=this.authGeneration;
    const result:MediaItem[]=[],seen=new Set<string>();
    // The entire authorized Movie/Series library may span thousands
    // of items. Keep the old 6000 safety bound, but fetch the remaining
    // pages in groups of at most three after learning the first page's
    // authoritative TotalRecordCount (much faster on a large catalogue).
    const readPage=async(offset:number)=>{
      const path=this.userItems({
        IncludeItemTypes:"Movie,Series",SortBy:"PremiereDate",
        SortOrder:"Descending",Limit:200,StartIndex:offset,
        EnableTotalRecordCount:"true"
      });
      const reply=obj(await this.json(path,{
        maxBytes:1048576,timeoutMs:12000
      }));
      this.assertSession(uid,generation);
      if(!Array.isArray(reply.Items) || reply.Items.length>200)
        throw new Error("UNIVERSE_SCOPE_INVALID");
      return {items:parseItems(reply,200),rawLength:reply.Items.length,
        count:typeof reply.TotalRecordCount==="number" &&
          Number.isSafeInteger(reply.TotalRecordCount) &&
          reply.TotalRecordCount>=0?reply.TotalRecordCount:null};
    };
    const append=(items:MediaItem[])=>{
      for(const item of items){
        const key=item.id.toLowerCase();
        if((item.type==="Movie" || item.type==="Series") && !seen.has(key)){
          seen.add(key);result.push(item);
        }
      }
    };
    const first=await readPage(0);
    append(first.items);
    if(first.rawLength<200 || (first.count!==null &&
      first.count<=first.rawLength))return result;
    const limit=first.count!==null?
      Math.min(6000,first.count):6000;
    for(let start=200;start<limit;start+=600){
      const offsets=[start,start+200,start+400].filter(x=>x<limit);
      const pages=await Promise.all(offsets.map(readPage));
      this.assertSession(uid,generation);
      let finished=false;
      for(let i=0;i<pages.length;i++){
        if(finished)break;
        const page=pages[i];
        append(page.items);
        if(page.rawLength<200 || (page.count!==null &&
          offsets[i]+page.rawLength>=page.count))finished=true;
      }
      if(finished)break;
    }
    this.assertSession(uid,generation);
    return result;
  }
  async getUserAvatar():Promise<Blob|null>{
    const uid=this.requireUser(),generation=this.authGeneration;
    const url=new URL("/Users/"+uid+"/Images/Primary",this.origin);
    let response:Response;
    try{
      response=await this.fetcher(url,{
        method:"GET",headers:identityHeaders(this.token,this.deviceId),
        credentials:"omit",cache:"no-store",mode:"cors",redirect:"error",
        referrerPolicy:"no-referrer",signal:AbortSignal.timeout(8000)
      });
    }catch{return null;}
    this.assertSession(uid,generation);
    if(!response.ok || response.redirected)return null;
    if(!/image\/(jpeg|png|webp)/i.test(response.headers.get("Content-Type")??""))
      return null;
    const length=Number(response.headers.get("Content-Length")??0);
    if(length>524288)return null;
    const content=await response.blob();
    this.assertSession(uid,generation);
    if(content.size>524288 || content.size===0)return null;
    return content;
  }
  /** Public TMDb popularity *through the pinned Jellyfin-hosted proxy*.
   * Do not reuse this.json: that method attaches the private Jellyfin token.
   * Never pass credentials to the TMDb endpoint or trust its results as
   * evidence that a user has access to the corresponding Jellyfin title. */
  async getTrendingRanks():Promise<TrendingRank[]>{
    const uid=this.requireUser(),generation=this.authGeneration;
    const read=async(kind:"movie"|"tv",page:number):Promise<TrendingRank[]>=>{
      const url=new URL("/tmdb/discover/"+kind,this.origin);
      url.search=new URLSearchParams({
        sort_by:"popularity.desc",language:"fr-FR",
        page:String(page),include_adult:"false"
      }).toString();
      if(url.origin!==this.origin)throw new Error("TRENDING_ORIGIN_INVALID");
      let response:Response;
      try{
        response=await this.fetcher(url,{
          method:"GET",headers:{Accept:"application/json"},
          mode:"cors",credentials:"omit",cache:"no-store",redirect:"error",
          referrerPolicy:"no-referrer",signal:AbortSignal.timeout(6000)
        });
      }catch{return [];}
      this.assertSession(uid,generation);
      if(!response.ok || response.redirected ||
        !(response.headers.get("Content-Type")??"").toLowerCase()
          .startsWith("application/json"))return [];
      const length=response.headers.get("Content-Length");
      if(length && Number(length)>524288)return [];
      let parsed:Record<string,unknown>;
      try{
        const text=await response.text();
        if(text.length>524288)return [];
        parsed=obj(JSON.parse(text));
      }catch{return [];}
      this.assertSession(uid,generation);
      if(!Array.isArray(parsed.results) ||
        parsed.results.length>20)return [];
      const type=kind==="movie"?"Movie":"Series";
      return parsed.results.flatMap((row,index)=>{
        const meta=obj(row),id=meta.id;
        if(meta.adult===true || !Number.isSafeInteger(id) ||
          (id as number)<1 || (id as number)>999_999_999_999)
          return [];
        return [{
          type,tmdbId:String(id),
          rank:(page-1)*20+index+1
        }];
      });
    };
    const ranked:TrendingRank[]=[];
    for(let page=1;page<=3;page++){
      this.assertSession(uid,generation);
      const results=await Promise.all([
        read("movie",page),read("tv",page)
      ]);
      this.assertSession(uid,generation);
      ranked.push(...results[0],...results[1]);
    }
    return ranked;
  }
  async getRecent():Promise<MediaItem[]>{
    return this.items(this.userItems({
      IncludeItemTypes:"Movie,Series",SortBy:"DateCreated",
      SortOrder:"Descending",Limit:96
    }),96);
  }
  async getResume():Promise<MediaItem[]>{
    const uid=this.requireUser();
    return this.items("/UserItems/Resume?"+new URLSearchParams({
      userId:uid,StartIndex:"0",Limit:"100",
      IncludeItemTypes:"Movie,Episode",EnableUserData:"true"
    }),100);
  }
  async getNextUp():Promise<MediaItem[]>{
    const uid=this.requireUser(),generation=this.authGeneration;
    const result:MediaItem[]=[],seen=new Set<string>();
    // The Jellyfin skin fetches up to 300 NextUp records; continue a
    // second page for larger collections instead of silently losing shows.
    for(let offset=0;offset<600;offset+=300){
      const query=new URLSearchParams({
        userId:uid,StartIndex:String(offset),Limit:"300",
        Fields:"DateCreated,PremiereDate",EnableUserData:"true"
      });
      let raw:Record<string,unknown>;
      try{
        raw=obj(await this.json("/Shows/NextUp?"+query,{
          maxBytes:2097152,timeoutMs:12000
        }));
      }catch(error){
        this.assertSession(uid,generation);
        if(offset===0)throw error;
        break; // Keep already authorized episodes if the later page times out.
      }
      this.assertSession(uid,generation);
      if(!Array.isArray(raw.Items) || raw.Items.length>300)
        throw new Error("NEXT_UP_INVALID");
      for(const item of parseItems(raw,300)){
        const key=item.id.toLowerCase();
        if(!seen.has(key)){seen.add(key);result.push(item);}
      }
      const count=raw.TotalRecordCount;
      if(raw.Items.length<300 ||
        (typeof count==="number" && Number.isSafeInteger(count) &&
         count<=offset+raw.Items.length))break;
    }
    return result;
  }
  async getRecentSeasons(now=new Date()):Promise<RecentSeason[]>{
    const uid=this.requireUser(),generation=this.authGeneration;
    const path=this.userItems({
      IncludeItemTypes:"Season",SortBy:"PremiereDate",
      SortOrder:"Descending",Limit:300,
      Fields:"PremiereDate,SeriesId,IndexNumber"
    });
    const response=obj(await this.json(path,{maxBytes:1048576}));
    this.assertSession(uid,generation);
    if(!Array.isArray(response.Items) || response.Items.length>300)
      throw new Error("SEASONS_INVALID");
    const today=now.getTime();
    const dedup=new Map<string,RecentSeason>();
    for(const raw of response.Items){
      const row=obj(raw);
      if(!validId(row.Id) || !validId(row.SeriesId) ||
        !Number.isSafeInteger(row.IndexNumber) ||
        (row.IndexNumber as number)<1 ||
        (row.IndexNumber as number)>1000 ||
        typeof row.PremiereDate!=="string")continue;
      const release=Date.parse(row.PremiereDate);
      if(!Number.isFinite(release) || release<today-60*86400000 ||
        release>today+86400000)continue;
      const season:RecentSeason={
        seriesId:row.SeriesId,seasonId:row.Id,
        number:row.IndexNumber as number,
        premiereDate:row.PremiereDate.slice(0,32)
      };
      const old=dedup.get(season.seriesId.toLowerCase());
      if(!old || Date.parse(old.premiereDate)<release)
        dedup.set(season.seriesId.toLowerCase(),season);
    }
    return [...dedup.values()];
  }
  async getNextUpSeries(next:readonly MediaItem[]):Promise<MediaItem[]>{
    const uid=this.requireUser(),generation=this.authGeneration;
    this.assertSession(uid,generation);
    const seen=new Set<string>();
    // The NextUp fetch may return 600 different series. Previous versions
    // silently dropped metadata for every series beyond the first 300,
    // preventing their genuine new seasons from being detected.
    const ids=next.map(ep=>ep.seriesId).filter((id):id is string=>
      !!id && validId(id) && !seen.has(id.toLowerCase()) &&
      !!seen.add(id.toLowerCase())).slice(0,600);
    const groups:Array<string[]>=[];
    for(let i=0;i<ids.length;i+=60)groups.push(ids.slice(i,i+60));
    const rows:MediaItem[]=[];
    // Bound fan-out to three requests so enrichment remains responsive
    // without flooding Jellyfin. Keep the server's own authorization scope.
    for(let start=0;start<groups.length;start+=3){
      const pages=await Promise.all(groups.slice(start,start+3).map(async selection=>{
        const path=this.userItems({
          Ids:selection.join(","),IncludeItemTypes:"Series",Limit:60
        });
        const response=obj(await this.json(path,{maxBytes:786432}));
        this.assertSession(uid,generation);
        if(!Array.isArray(response.Items) || response.Items.length>60)
          throw new Error("SERIES_SCOPE_INVALID");
        const authorized=new Set(selection.map(x=>x.toLowerCase()));
        return parseItems(response,60).filter(media=>
          media.type==="Series" && authorized.has(media.id.toLowerCase()));
      }));
      this.assertSession(uid,generation);
      for(const page of pages)rows.push(...page);
    }
    return rows;
  }
  async updateMediaState(itemId:string,action:"favorite"|"played",
    enabled:boolean):Promise<void>{
    const uid=this.requireUser(),generation=this.authGeneration;
    if(!validId(itemId) || !["favorite","played"].includes(action) ||
      typeof enabled!=="boolean")throw new Error("MEDIA_ACTION_DENIED");
    const resource=action==="favorite"?"FavoriteItems":"PlayedItems";
    const url=new URL("/Users/"+uid+"/"+resource+"/"+itemId,this.origin);
    if(url.origin!==this.origin)throw new Error("URL_DENIED");
    let response:Response;
    try{
      response=await this.fetcher(url,{
        method:enabled?"POST":"DELETE",
        headers:identityHeaders(this.token,this.deviceId),
        credentials:"omit",cache:"no-store",mode:"cors",redirect:"error",
        referrerPolicy:"no-referrer",signal:AbortSignal.timeout(12000)
      });
    }catch{throw new Error("NETWORK_UNAVAILABLE");}
    this.assertSession(uid,generation);
    if(!response.ok || response.redirected)
      throw new Error("MEDIA_ACTION_DENIED");
  }
  async getFavorites():Promise<MediaItem[]>{
    return this.items(this.userItems({
      IncludeItemTypes:"Movie,Series",Filters:"IsFavorite",
      SortBy:"DateCreated",SortOrder:"Descending",Limit:40
    }),40);
  }
  async getCandidates(now=new Date()):Promise<MediaItem[]>{
    const uid=this.requireUser(),generation=this.authGeneration;
    const readPage=async(startIndex:number,optional=false)=>{
      const url=this.userItems({
        IncludeItemTypes:"Movie,Series",Filters:"IsUnplayed",
        SortBy:"DateCreated",SortOrder:"Descending",
        EnableTotalRecordCount:"true",
        StartIndex:startIndex,Limit:CANDIDATE_BATCH_SIZE
      });
      // Optional archive reads never hold the homepage for more than 1.5s.
      const response=obj(await this.json(url,{
        maxBytes:1048576,timeoutMs:optional?1500:12000
      }));
      this.assertSession(uid,generation);
      if(!Array.isArray(response.Items) ||
         response.Items.length>CANDIDATE_BATCH_SIZE)
        throw new Error("CANDIDATES_INVALID");
      const rawIds=new Set<string>();
      for(const entry of response.Items){
        const row=obj(entry);
        if(!validId(row.Id) || rawIds.has(row.Id.toLowerCase()))
          throw new Error("CANDIDATES_INVALID");
        rawIds.add(row.Id.toLowerCase());
      }
      const total=typeof response.TotalRecordCount==="number" &&
        Number.isSafeInteger(response.TotalRecordCount) &&
        response.TotalRecordCount>=startIndex+response.Items.length &&
        response.TotalRecordCount<=1_000_000_000
        ?response.TotalRecordCount:null;
      const items=parseItems(response,CANDIDATE_BATCH_SIZE).filter(item=>
        (item.type==="Movie" || item.type==="Series") && !item.played);
      return {items,total,consumed:response.Items.length};
    };
    const recent=await readPage(0);
    if(recent.total===null || recent.consumed===0)return recent.items;
    const seen=new Set(recent.items.map(item=>item.id));
    const result=[...recent.items];
    for(const offset of candidateOffsets(uid,recent.total,now)){
      this.assertSession(uid,generation);
      try{
        const page=await readPage(offset,true);
        // A stale or incoherent window is not evidence of additional
        // entitlements. Preserve verified recent titles and stop sampling.
        if(page.total!==recent.total || page.consumed===0 ||
           page.items.some(item=>seen.has(item.id)))break;
        for(const item of page.items){
          seen.add(item.id);result.push(item);
        }
      }catch(error){
        if(error instanceof Error && error.message==="SESSION_CHANGED")
          throw error;
        break;
      }
    }
    this.assertSession(uid,generation);
    return result;
  }
  async getWatched():Promise<MediaItem[]>{
    const uid=this.requireUser(),generation=this.authGeneration;
    const items:MediaItem[]=[],seen=new Set<string>();
    // Franchise evidence must not be limited to the 96 latest watches.
    // Work is background-only, bounded at 600 items and per-user scoped.
    for(let offset=0;offset<600;offset+=200){
      const path=this.userItems({
        IncludeItemTypes:"Movie,Series",Filters:"IsPlayed",
        SortBy:"DatePlayed",SortOrder:"Descending",
        Limit:200,StartIndex:offset
      });
      let raw:Record<string,unknown>;
      try{
        raw=obj(await this.json(path,{
          maxBytes:1572864,timeoutMs:12000
        }));
      }catch(error){
        this.assertSession(uid,generation);
        if(offset===0)throw error;
        break; // Later history pages must not erase already read favorites.
      }
      this.assertSession(uid,generation);
      if(!Array.isArray(raw.Items) || raw.Items.length>200)
        throw new Error("WATCH_HISTORY_INVALID");
      for(const entry of parseItems(raw,200)){
        const key=entry.id.toLowerCase();
        if(!seen.has(key)){seen.add(key);items.push(entry);}
      }
      const count=raw.TotalRecordCount;
      if(raw.Items.length<200 ||
        (typeof count==="number" && Number.isSafeInteger(count) &&
         count<=offset+raw.Items.length))break;
    }
    return items;
  }
  async getCollections():Promise<MediaItem[]>{
    return this.items(this.userItems({
      IncludeItemTypes:"BoxSet",SortBy:"SortName",
      SortOrder:"Ascending",Limit:48
    }),48);
  }
  async search(text:string):Promise<MediaItem[]>{
    const query=text.trim().slice(0,90);
    if(query.length<2)return [];
    return this.items(this.userItems({
      IncludeItemTypes:"Movie,Series",
      SearchTerm:query,SortBy:"SortName",Limit:40
    }),40);
  }
  async image(item:MediaItem,kind:"Primary"|"Backdrop"|"Thumb"):Promise<Blob|null>{
    if((kind==="Primary" && !item.hasPrimary) ||
       (kind==="Backdrop" && !item.hasBackdrop) ||
       (kind==="Thumb" && !item.hasThumb))return null;
    return this.imageById(item.id,kind);
  }
  async imageById(id:string,kind:"Primary"|"Backdrop"|"Thumb"):Promise<Blob|null>{
    this.requireUser();
    if(!validId(id) || !["Primary","Backdrop","Thumb"].includes(kind))
      return null;
    const path="/Items/"+id+"/Images/"+kind+
      (kind==="Backdrop"?"/0?maxWidth=1280&quality=75":
       kind==="Thumb"?"?maxWidth=640&quality=76":
       "?maxHeight=560&quality=76");
    const response=await this.fetcher(new URL(path,this.origin),{
      method:"GET",headers:identityHeaders(this.token,this.deviceId),
      mode:"cors",credentials:"omit",cache:"no-store",redirect:"error",
      referrerPolicy:"no-referrer",signal:AbortSignal.timeout(10000)
    });
    const mime=(response.headers.get("Content-Type")??"").split(";")[0].trim().toLowerCase();
    if(!response.ok || response.redirected ||
       !["image/jpeg","image/png","image/webp"].includes(mime))
      return null;
    const max=1_572_864;
    const length=response.headers.get("Content-Length");
    if(length && Number(length)>max)return null;
    const blob=await response.blob();
    return blob.size>0 && blob.size<=max?blob:null;
  }
}
