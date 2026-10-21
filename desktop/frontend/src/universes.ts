import type {MediaItem} from "./types";

export type UniverseId="mcu"|"disney"|"pixar"|"dreamworks"|"starwars"|"dc";
export interface Universe {
  id:UniverseId;label:string;logo:string;
}
export const UNIVERSES:readonly Universe[]=[
  {id:"mcu",label:"Marvel Cinematic Universe",logo:"/universes/mcu.png"},
  {id:"disney",label:"Disney",logo:"/universes/disney.png"},
  {id:"pixar",label:"Pixar",logo:"/universes/pixar.png"},
  {id:"dreamworks",label:"DreamWorks",logo:"/universes/dreamworks.png"},
  {id:"starwars",label:"Star Wars",logo:"/universes/starwars.svg"},
  {id:"dc",label:"DC",logo:"/universes/dc.png"}
];
const text=(item:MediaItem)=>[...(item.tags??[]),...(item.studios??[])]
  .map(value=>value.toLocaleLowerCase("en").trim());
export function belongsToUniverse(item:MediaItem,id:UniverseId):boolean{
  if(item.type!=="Movie" && item.type!=="Series")return false;
  const values=text(item);
  const matches=(pattern:RegExp)=>values.some(x=>pattern.test(x));
  const name=item.title.toLocaleLowerCase("fr");
  switch(id){
    case "mcu":
      if(/legends|légendes des studios marvel|special presentation|lego/i.test(name))
        return false;
      return matches(/marvel cinematic universe|\bmcu\b/i) ||
        (item.type==="Movie" && (item.year??0)>=2008 &&
          matches(/^marvel studios$/i));
    case "disney":
      return matches(/walt disney pictures|walt disney animation/i);
    case "pixar":
      return matches(/\bpixar\b/i);
    case "dreamworks":
      return matches(/dreamworks animation|dreamworks pictures/i);
    case "starwars":
      return matches(/\bstar wars\b|\blucasfilm\b/i);
    case "dc":
      return matches(/^dc$|dc entertainment|dc films|dc comics|dc extended universe|dc studios/i);
  }
}
export function universeItems(universe:UniverseId,
  catalog:readonly MediaItem[]):MediaItem[]{
  const seen=new Set<string>();
  return catalog.filter(item=>{
    if(!belongsToUniverse(item,universe) || seen.has(item.id))return false;
    seen.add(item.id);return true;
  }).sort((a,b)=>(a.year??0)-(b.year??0) ||
    a.title.localeCompare(b.title,"fr"));
}
