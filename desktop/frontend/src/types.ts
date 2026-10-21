export type MediaType="Movie"|"Series"|"Episode"|"BoxSet"|"Playlist";
export type LibraryGroupKind="BoxSet"|"Playlist";
export type CatalogKind="Movie"|"Series"|"Anime";
export type CatalogLibraryIds=Record<CatalogKind,string|null>;
export interface CatalogPage {
  items:MediaItem[];
  nextOffset:number|null;
  total:number|null;
  libraryAvailable:boolean;
}
export interface SeasonSummary {
  id:string;
  title:string;
  number:number|null;
  episodeCount:number|null;
  unplayedCount:number|null;
}
export interface EpisodePage {
  items:MediaItem[];
  total:number|null;
  nextOffset:number|null;
}
export type PlaybackTrackKind="Video"|"Audio"|"Subtitle";
export interface PlaybackTrack {
  kind:PlaybackTrackKind;
  index:number;
  codec:string;
  language:string;
  title:string;
  width:number|null;
  height:number|null;
  channels:number|null;
  isDefault:boolean;
  isExternal:boolean;
}
export interface PlaybackSource {
  title:string;
  container:string;
  bitrate:number|null;
  directPlay:boolean;
  directStream:boolean;
  transcoding:boolean;
  tracks:PlaybackTrack[];
}
export interface PlaybackProbe {
  sources:PlaybackSource[];
  errorCode:string|null;
}
export type ViewKey="home"|"movies"|"series"|"anime"|"collections"|"playlists"|"favorites";
export interface MediaItem {
  id:string;
  title:string;
  type:MediaType;
  year:number|null;
  overview:string;
  genres:string[];
  tags?:string[];
  studios?:string[];
  communityRating:number|null;
  isFavorite:boolean;
  played:boolean;
  progress:number|null;
  premiereDate:string;
  hasPrimary:boolean;
  hasBackdrop:boolean;
  hasThumb?:boolean;
  parentBackdropItemId?:string|null;
  hasParentBackdrop?:boolean;
  seriesId?:string|null;
  seasonId?:string|null;
  playedPercentage?:number|null;
  franchiseId?:string|null;
  tmdbId?:string|null;
  tvdbCollectionIds?:string[];
  seasonNumber?:number|null;
  episodeNumber?:number|null;
  runtimeTicks?:number|null;
  seasonCount?:number|null;
  seriesName:string;
}
export interface SessionPublic {
  userId:string;
  username:string;
}
export interface LibrarySnapshot {
  recent:MediaItem[];
  candidates?:MediaItem[];
  resume:MediaItem[];
  nextUp:MediaItem[];
  favorites:MediaItem[];
  watched:MediaItem[];
  collections:MediaItem[];
}
export interface Shelf {
  id:string;
  title:string;
  items:MediaItem[];
  kind?:"standard"|"top10"|"universe";
  reasons?:Record<string,string>;
}
