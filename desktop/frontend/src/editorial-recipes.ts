import type {MediaItem,Shelf} from "./types";

/** Portable, metadata-only subset of G7x's public editorial taxonomy.
 * Does not call a model or claim that the LLM has classified any item.
 * Recipes require strong evidence from Jellyfin's actual genre/year labels.
 */
export interface EditorialRecipe {
  key:string;
  title:string;
  mode:"genre"|"mix"|"kind"|"period"|"recent"|"classic"|"rated"|"favourite";
  groups:readonly string[];
}
type Simple=[string,string,string];
const GENRES:readonly Simple[]=[
  ["action","Action sans compromis","action"],
  ["adventure","Des aventures à vivre","aventure|adventure"],
  ["scifi","Cap sur la science-fiction","science fiction|sci fi|sf"],
  ["fantasy","Mondes fantastiques","fantasy|fantastique"],
  ["comedy","Une bonne dose d'humour","comedy|comedie"],
  ["drama","Des histoires qui marquent","drama|drame"],
  ["crime","Enquêtes et affaires criminelles","crime|policier"],
  ["thriller","Le suspense jusqu'au bout","thriller|suspense"],
  ["mystery","Mystères à résoudre","mystery|mystere"],
  ["horror","Frissons garantis","horror|horreur|epouvante"],
  ["animation","L'animation à l'honneur","animation|anime"],
  ["anime","Les animés à découvrir","anime"],
  ["family","À regarder en famille","family|famille"],
  ["romance","Histoires d'amour","romance|romantic"],
  ["documentary","Histoires vraies en documentaire","documentary|documentaire"],
  ["history","Voyages dans l'histoire","history|histoire"],
  ["war","Récits de guerre","war|guerre"],
  ["western","L'esprit western","western"],
  ["music","La musique à l'écran","music|musique"],
  ["biography","Destins inspirés de faits réels","biography|biographie"],
  ["sport","Sport et dépassement","sport"]
];
type Mix=[string,string,readonly string[]];
const COMBOS:readonly Mix[]=[
  ["scifi-action","Action et science-fiction",["action","science fiction|sci fi|sf"]],
  ["crime-drama","Polars dramatiques",["crime|policier","drame|drama"]],
  ["comic-romance","Comédies romantiques",["comedy|comedie","romance|romantic"]],
  ["fantasy-adventure","Épopées fantastiques",["fantasy|fantastique","adventure|aventure"]],
  ["horror-thriller","Thrillers à frissons",["horror|horreur","thriller|suspense"]],
  ["anime-action","Animés pleins d'action",["anime|animation","action"]],
  ["family-animation","Animation pour tous",["animation","family|famille"]],
  ["mystery-crime","Enquêtes mystérieuses",["mystery|mystere","crime|policier"]],
  ["scifi-drama","Science-fiction et émotions",["science fiction|sci fi|sf","drama|drame"]],
  ["comedy-action","Action avec humour",["comedy|comedie","action"]],
  ["adventure-animation","Aventures animées",["animation","adventure|aventure"]],
  ["history-documentary","Documentaires historiques",["documentary|documentaire","history|histoire"]],
  ["drama-romance","Histoires d'amour intenses",["drama|drame","romance|romantic"]],
  ["war-drama","Drames de guerre",["war|guerre","drama|drame"]]
];
const extras:readonly EditorialRecipe[]=[
  {key:"format-movies",title:"Le grand écran chez vous",mode:"kind",groups:["Movie"]},
  {key:"format-series",title:"Séries à commencer",mode:"kind",groups:["Series"]},
  {key:"period-90",title:"Ambiance années 90",mode:"period",groups:["1990"]},
  {key:"period-00",title:"Années 2000 à redécouvrir",mode:"period",groups:["2000"]},
  {key:"period-10",title:"Les années 2010",mode:"period",groups:["2010"]},
  {key:"period-20",title:"Créations des années 2020",mode:"period",groups:["2020"]},
  {key:"recent",title:"Sorties des deux dernières années",mode:"recent",groups:[]},
  {key:"classics",title:"Des classiques d'avant 2000",mode:"classic",groups:[]},
  {key:"rated",title:"Bien notés dans Jellyfin",mode:"rated",groups:[]},
  {key:"watchlist",title:"Dans vos favoris non commencés",mode:"favourite",groups:[]}
];
// Exactly G7x's 45 recipes that only require metadata present in this
// native UI. The 46th G7x "saga" recipe requires Collection IDs that our
// current MediaItem schema cannot evidence; never pretend we know them.
export const EDITORIAL_RECIPES:readonly EditorialRecipe[]=[
  ...GENRES.map(([key,title,group])=>({
    key:"genre-"+key,title,mode:"genre" as const,groups:[group]
  })),
  ...COMBOS.map(([key,title,groups])=>({
    key:"mix-"+key,title,mode:"mix" as const,groups
  })),
  ...extras
];
function normalizeGenre(value:string):string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function groupMatches(genres:Set<string>,alternatives:string):boolean {
  return alternatives.split("|").some(label=>
    genres.has(normalizeGenre(label)));
}
export function recipeMatches(recipe:EditorialRecipe,
    item:MediaItem,now:Date):boolean{
  if(item.played || item.type==="Episode" || item.type==="BoxSet")return false;
  if(item.year!==null && item.year>now.getUTCFullYear())return false;
  const premiere=item.premiereDate.slice(0,10);
  if(/^\d{4}-\d{2}-\d{2}$/.test(premiere) &&
     premiere>now.toISOString().slice(0,10))return false;
  const genreSet=new Set(item.genres.map(normalizeGenre));
  switch(recipe.mode){
    case "genre":return groupMatches(genreSet,recipe.groups[0]);
    case "mix":return recipe.groups.every(x=>groupMatches(genreSet,x));
    case "kind":return item.type===recipe.groups[0];
    case "period":return item.year!==null &&
      item.year>=Number(recipe.groups[0]) &&
      item.year<Number(recipe.groups[0])+10;
    case "recent":return item.year!==null &&
      item.year>=now.getUTCFullYear()-2;
    case "classic":return item.year!==null && item.year>=1900 &&
      item.year<2000;
    case "rated":return item.communityRating!==null &&
      item.communityRating>=7.5;
    case "favourite":return item.isFavorite;
  }
}
function seededRank(key:string):number {
  let seed=2166136261;
  for(const char of key){
    seed=Math.imul(seed^char.charCodeAt(0),16777619);
  }
  return seed>>>0;
}
export function rotatingEditorial(
  input:readonly MediaItem[],
  userId:string,
  now=new Date(),
  maxRows=10,
  maxCards=5
):Shelf[]{
  // Input MUST come from user-scoped Jellyfin API. This function never
  // creates recommendation candidates; it only filters visible IDs.
  if(!/^[a-f0-9]{32}$/i.test(userId) || !Number.isInteger(maxRows) ||
     maxRows<0 || maxRows>14 || maxCards<3 || maxCards>12)
    throw new Error("EDITORIAL_SCOPE_INVALID");
  const candidates=Array.from(new Map(input.slice(0,512)
    .map(i=>[i.id,i])).values()).filter(i=>
      !i.played && i.type!=="Episode" && i.type!=="BoxSet" &&
      (i.year===null || i.year<=now.getUTCFullYear()));
  const today=now.toISOString().slice(0,10);
  const seed=userId+":"+today;
  const recipes=EDITORIAL_RECIPES.map(recipe=>{
    const matches=candidates.filter(i=>recipeMatches(recipe,i,now));
    const prio=Math.min(matches.length,14)*13+
      seededRank(seed+":section:"+recipe.key)%100;
    return {recipe,matches,prio};
  }).filter(r=>r.matches.length>=3)
    .sort((a,b)=>b.prio-a.prio ||
      a.recipe.key.localeCompare(b.recipe.key));
  const used=new Set<string>(),output:Shelf[]=[];
  for(const entry of recipes){
    if(output.length>=maxRows)break;
    const available=entry.matches.filter(i=>!used.has(i.id))
      .sort((a,b)=>{
        const value=(i:MediaItem)=>
          (i.communityRating??0)*50+
          (i.year??1900)/100+
          (seededRank(seed+":"+entry.recipe.key+":"+i.id)%100);
        return value(b)-value(a)||a.id.localeCompare(b.id);
      });
    if(available.length<3)continue;
    const items=available.slice(0,maxCards);
    output.push({
      id:"editorial-"+entry.recipe.key,
      title:entry.recipe.title,
      items,kind:"standard"
    });
    for(const item of items)used.add(item.id);
  }
  return output;
}
