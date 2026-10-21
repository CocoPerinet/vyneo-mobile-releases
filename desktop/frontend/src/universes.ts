import type {MediaItem} from "./types";

export type UniverseId="mcu"|"disney"|"pixar"|"dreamworks"|"starwars"|"dc"|"dcu";
export interface Universe {
  id:UniverseId;label:string;logo:string;
}
export const UNIVERSES:readonly Universe[]=[
  {id:"mcu",label:"Marvel Cinematic Universe",logo:"/universes/mcu.png"},
  {id:"disney",label:"Disney",logo:"/universes/disney.png"},
  {id:"pixar",label:"Pixar",logo:"/universes/pixar.png"},
  {id:"dreamworks",label:"DreamWorks",logo:"/universes/dreamworks.png"},
  {id:"starwars",label:"Star Wars",logo:"/universes/starwars.svg"},
  {id:"dc",label:"DC",logo:"/universes/dc.png"},
  {id:"dcu",label:"Nouveau DCU",logo:"/universes/dcu.png"}
];
const text=(item:MediaItem)=>[...(item.tags??[]),...(item.studios??[])]
  .map(value=>value.toLocaleLowerCase("en").trim());
// The real Jellyfin injector rejects promotional footage from *every*
// branded universe, even when it carries an exact studio/tag match.
const NOT_A_WORK=/world premiere|premi[èe]re mondiale|red carpet|tapis rouge|behind the scenes|making[- ]of|featurette|special look|comic[- ]?con/i;
const MCU_EXTRAS=/pr[ée]sentation sp[ée]ciale|special presentation|\bLEGO\b|werewolf by night|joyeuses f[êe]tes|l[ée]gendes des studios marvel|marvel studios:? legends/i;
export function belongsToUniverse(item:MediaItem,id:UniverseId):boolean{
  if((item.type!=="Movie" && item.type!=="Series") ||
    NOT_A_WORK.test(item.title))return false;
  const values=text(item);
  const matches=(pattern:RegExp)=>values.some(x=>pattern.test(x));
  const name=item.title.toLocaleLowerCase("fr");
  switch(id){
    case "mcu":
      if(MCU_EXTRAS.test(name))return false;
      return matches(/marvel cinematic universe|\bmcu\b/i) ||
        (item.type==="Movie" && (item.year??0)>=2008 &&
          matches(/^marvel studios$/i));
    case "disney":
      return matches(/walt disney pictures/i);
    case "pixar":
      return matches(/\bpixar\b/i);
    case "dreamworks":
      return matches(/dreamworks animation/i);
    case "starwars":
      // Lucasfilm alone also produces Indiana Jones and Labyrinth. The
      // original Jellyfin theme has explicit series-title fallbacks for
      // works whose Jellyfin studio is their TV broadcaster (Disney+).
      if(/indiana jones|labyrinthe|^mishima$|aventuriers de l.arche perdue/i.test(name))return false;
      return matches(/\bstar wars\b/i) ||
        (matches(/\blucasfilm\b/i) &&
          !/indiana jones|labyrinthe|^mishima$/i.test(name)) ||
        /^(andor|ahsoka|obi-wan kenobi|the mandalorian|tales of the jedi|tales of the empire|the clone wars|the bad batch|skeleton crew|the acolyte|the book of boba fett|le livre de boba fett|young jedi adventures|star wars[\s:,-]|rogue one|solo\s*:)/i.test(name);
    case "dc":
      // The original Jellyfin keeps the DC Studios reboot separate.
      if(matches(/^dc studios$/i))return false;
      return matches(/^dc$|dc entertainment|dc films|dc universe|dc comics|dc extended universe/i) ||
        /^(joker|justice league|lego dc|batman et harley quinn)(?:\b|\s|:)/i.test(name);
    case "dcu":
      return (item.year??0)>=2025 && matches(/^dc studios$/i);
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

/** Reproduces the real Jellyfin injector's universe grouping and internal
 * chronology (inject.js:13480-13775), using *only authorized local items*.
 * No LLM inference, remote taxonomy or invented unreleased titles. */
export interface UniverseGroup {name:string;items:MediaItem[];}
const STAR_WARS_CHRONOLOGY:readonly (readonly [string,RegExp])[]=[
  ["La Haute République",/young jedi adventures/i],
  ["La Haute République",/^(?:star wars\s*:\s*)?(?:the acolyte|l.acolyte)$/i],
  ["La Prélogie",/épisode\s+i\b|phantom menace|menace fant[oô]me/i],
  ["La Prélogie",/épisode\s+ii\b|attack of the clones|attaque des clones/i],
  ["La Prélogie",/tales of the jedi/i],
  ["La Prélogie",/clone wars/i],
  ["La Prélogie",/maul,?\s*seigneur de l.ombre|maul.*shadow lord/i],
  ["La Prélogie",/épisode\s+iii\b|revenge of the sith|revanche des sith/i],
  ["Trilogie originale",/bad batch/i],
  ["Trilogie originale",/^solo\s*:/i],
  ["Trilogie originale",/obi-wan kenobi/i],
  ["Trilogie originale",/tales of the empire/i],
  ["Trilogie originale",/rebels/i],
  ["Trilogie originale",/^andor$/i],
  ["Trilogie originale",/rogue one/i],
  ["Trilogie originale",/^la guerre des étoiles$|a new hope|nouvel espoir/i],
  ["Trilogie originale",/l.empire contre-attaque|empire strikes back/i],
  ["Trilogie originale",/le retour du jedi|return of the jedi/i],
  ["Trilogie de la suite",/^the mandalorian$/i],
  ["Trilogie de la suite",/boba fett/i],
  ["Trilogie de la suite",/^ahsoka$/i],
  ["Trilogie de la suite",/skeleton crew/i],
  ["Trilogie de la suite",/mandalorian and grogu/i],
  ["Trilogie de la suite",/star wars\s*:\s*resistance/i],
  ["Trilogie de la suite",/réveil de la force|force awakens/i],
  ["Trilogie de la suite",/derniers jedi|last jedi/i],
  ["Trilogie de la suite",/ascension de skywalker|rise of skywalker/i],
  ["Visions",/visions/i]
];
const PHASES:readonly (readonly [string,string,string])[]=[
  ["Phase 1","2008-01-01","2013-01-01"],
  ["Phase 2","2013-01-01","2016-01-01"],
  ["Phase 3","2016-01-01","2020-01-01"],
  ["Phase 4","2020-01-01","2023-01-01"],
  ["Phase 5","2023-01-01","2025-06-01"],
  ["Phase 6","2025-06-01","2100-01-01"]
];
const releaseTimestamp=(item:MediaItem):number=>{
  const iso=Date.parse(item.premiereDate);
  return Number.isFinite(iso)?iso:
    item.year!==null?Date.UTC(item.year,0,1):Number.POSITIVE_INFINITY;
};
const releaseSort=(a:MediaItem,b:MediaItem)=>releaseTimestamp(a)-
  releaseTimestamp(b) || a.title.localeCompare(b.title,"fr");
export function groupUniverseItems(id:UniverseId,
  catalog:readonly MediaItem[]):UniverseGroup[]{
  const items=universeItems(id,catalog);
  const groups=new Map<string,MediaItem[]>();
  const put=(name:string,item:MediaItem)=>{
    if(!groups.has(name))groups.set(name,[]);
    groups.get(name)!.push(item);
  };
  if(id==="starwars"){
    // Within each era, order by fictional chronology rather than release
    // year (e.g. Andor must precede Episode IV despite its later release).
    const order=new Map<string,number>();
    for(const item of items){
      const rank=STAR_WARS_CHRONOLOGY.findIndex(([,regex])=>
        regex.test(item.title));
      const name=rank<0?"Autres aventures Star Wars":
        STAR_WARS_CHRONOLOGY[rank][0];
      put(name,item);order.set(item.id,rank<0?999:rank);
    }
    return [...groups.entries()].sort((a,b)=>{
      const rank=(name:string)=>{
        const i=STAR_WARS_CHRONOLOGY.findIndex(x=>x[0]===name);
        return i<0?999:i;
      };
      return rank(a[0])-rank(b[0]);
    }).map(([name,entries])=>({name,
      items:entries.sort((a,b)=>
        (order.get(a.id)??999)-(order.get(b.id)??999)||
        releaseSort(a,b))}));
  }
  if(id==="mcu"){
    for(const item of items){
      const timestamp=releaseTimestamp(item);
      const phase=PHASES.find(([,from,to])=>
        timestamp>=Date.parse(from) && timestamp<Date.parse(to));
      put(phase?.[0]??"Phase à confirmer",item);
    }
    return [...groups.entries()].sort((a,b)=>{
      const rank=(name:string)=>PHASES.findIndex(x=>x[0]===name);
      return (rank(a[0])<0?999:rank(a[0]))-
        (rank(b[0])<0?999:rank(b[0]));
    }).map(([name,entries])=>({name,items:entries.sort(releaseSort)}));
  }
  if(id==="dcu"){
    return items.length?[{name:"Chapitre 1 : Gods and Monsters",
      items:[...items].sort(releaseSort)}]:[];
  }
  // Decades are the exact logic of Jellyfin's Disney/Pixar/DreamWorks/DC.
  // Keep undated authorized works in a named fallback instead of dropping.
  for(const item of items){
    const name=item.year===null?"Date inconnue":
      "Années "+Math.floor(item.year/10)*10;
    put(name,item);
  }
  return [...groups.entries()].sort((a,b)=>{
    if(a[0]==="Date inconnue")return 1;
    if(b[0]==="Date inconnue")return -1;
    return Number(a[0].slice(7))-Number(b[0].slice(7));
  }).map(([name,entries])=>({name,items:entries.sort(releaseSort)}));
}
