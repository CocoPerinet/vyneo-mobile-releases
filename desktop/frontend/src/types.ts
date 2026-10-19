export type MediaType="Movie"|"Series"|"Episode"|"BoxSet";
export type CatalogKind="Movie"|"Series"|"Anime";
export type CatalogLibraryIds=Record<CatalogKind,string|null>;
export interface CatalogPage {
  items:MediaItem[];
  nextOffset:number|null;
  total:number|null;
  libraryAvailable:boolean;
}
export type ViewKey="home"|"movies"|"series"|"anime"|"favorites"|"universes";
export interface MediaItem {
  id:string;
  title:string;
  type:MediaType;
  year:number|null;
  overview:string;
  genres:string[];
  communityRating:number|null;
  isFavorite:boolean;
  played:boolean;
  progress:number|null;
  premiereDate:string;
  hasPrimary:boolean;
  hasBackdrop:boolean;
  seriesName:string;
}
export interface SessionPublic {
  userId:string;
  username:string;
}
export interface LibrarySnapshot {
  recent:MediaItem[];
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
}
