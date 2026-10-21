import type {MediaItem} from "./types";

export type MediaAction="favorite"|"played";
export interface MediaMutation {
  targetId:string;
  enabled:boolean;
}

// An episode favorite always belongs to its parent series. Missing parent
// scope is a hard deny, never a fallback to favoriting the episode itself.
export function planMediaMutation(
  item:MediaItem,action:MediaAction
):MediaMutation|null{
  if(action==="favorite"){
    const id=item.type==="Episode"?item.seriesId:item.id;
    if(!id)return null;
    return {targetId:id,enabled:!item.isFavorite};
  }
  return {targetId:item.id,enabled:!item.played};
}

export function projectMediaMutation(
  item:MediaItem,original:MediaItem,mutation:MediaMutation,
  action:MediaAction
):MediaItem{
  const target=mutation.targetId.toLowerCase();
  if(action==="favorite"){
    const direct=item.id.toLowerCase()===target;
    const descendant=item.type==="Episode" &&
      item.seriesId?.toLowerCase()===target;
    if(!direct && !descendant)return item;
    return {...item,isFavorite:mutation.enabled};
  }
  if(item.id.toLowerCase()!==original.id.toLowerCase())return item;
  return {...item,played:mutation.enabled,
    progress:mutation.enabled?null:item.progress,
    resumeTicks:mutation.enabled?null:item.resumeTicks};
}
