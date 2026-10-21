import {chromium} from "playwright-core";
import {createServer} from "node:http";
import {existsSync,readFileSync,mkdirSync} from "node:fs";
import {resolve,join,extname,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {strict as assert} from "node:assert";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const dist=resolve(root,"desktop","frontend","dist");
const out=resolve(root,"qa-shots");
mkdirSync(out,{recursive:true});
const mime={".html":"text/html",".js":"application/javascript",
 ".css":"text/css",".png":"image/png",".svg":"image/svg+xml"};
const image=readFileSync(join(root,"assets","icon.png"));
const http=createServer((req,res)=>{
 const name=decodeURIComponent(new URL(req.url??"/","http://127.0.0.1").pathname);
 const full=resolve(dist,"."+name.replace(/^\/$/,"/index.html"));
 if(!full.startsWith(dist)||!existsSync(full)){res.writeHead(404);res.end();return;}
 res.writeHead(200,{"Content-Type":mime[extname(full)]??"application/octet-stream"});
 res.end(readFileSync(full));
});
await new Promise(done=>http.listen(0,"127.0.0.1",done));
const port=http.address().port;
const id=n=>n.toString(16).padStart(32,"0");
const user=id(9999),token="z".repeat(52);
const films=Array.from({length:220},(_,n)=>({
 Id:id(n+1),Name:"Film de test "+(n+1),Type:"Movie",
 PremiereDate:"2026-09-15",ProductionYear:2026,
 DateCreated:"2026-10-17",Overview:"Un synopsis de démonstration pour Vynéo.",
 Genres:["Action"],Tags:n%2?["Marvel Cinematic Universe (MCU)"]:["Animation"],
 Studios:[{Name:n%2?"Marvel Studios":"Pixar Animation Studios"}],
 ProviderIds:{TmdbCollection:"113355"},CommunityRating:7.8,
 ImageTags:{Primary:"png"},BackdropImageTags:["png"],
 UserData:{Played:n<20,IsFavorite:n<5}
}));
const nextUp=Array.from({length:270},(_,n)=>({
 Id:id(3000+n),Name:"Épisode de test "+(n+1),Type:"Episode",
 SeriesName:"Série "+(n%50+1),SeriesId:id(100+n%50),
 SeasonId:n===0?id(9000):id(8000+n%100),
 ParentIndexNumber:2,IndexNumber:n===0?1:2,
 PremiereDate:"2026-09-15",ProductionYear:2026,
 Overview:"Suite à regarder.",Genres:["Action"],
 ImageTags:{Primary:"png"},BackdropImageTags:["png"],
 RunTimeTicks:18000000000,UserData:{Played:false,IsFavorite:false,
  PlaybackPositionTicks:0}
}));
const seriesIds=[...new Set(nextUp.map(ep=>ep.SeriesId))];
const bodyJson=x=>JSON.stringify(x);
const cors={"Access-Control-Allow-Origin":"*",
 "Access-Control-Allow-Headers":"authorization,content-type",
 "Access-Control-Allow-Methods":"GET,POST,DELETE,OPTIONS"};
const actions=[],external=[],errors=[];
const favoriteIds=new Set(),playedIds=new Set();
let browser;
try{
 browser=await chromium.launch({
  executablePath:process.env.CHROME_PATH||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless:true,args:["--disable-gpu","--no-first-run"]
 });
 const context=await browser.newContext({viewport:{width:1650,height:930}});
 await context.route("https://cocojellyfin.duckdns.org:38443/**",async route=>{
  const request=route.request(),url=new URL(request.url());
  const method=request.method(),path=url.pathname,qs=url.searchParams;
  external.push({url:request.url(),method});
  if(method==="OPTIONS")
   return route.fulfill({status:204,headers:cors,body:""});
  if(path.includes("/Images/")||path.includes("/Images/Primary")){
   // A corrupt Jellyfin response exercises the browser's actual image
   // decode error path, not only the API's missing-thumbnail fallback.
   const corrupt=path.includes("/Items/"+id(1)+"/Images/");
   return route.fulfill({status:200,contentType:"image/png",
    body:corrupt?Buffer.from("invalid-png-bytes"):image,
    headers:{"Access-Control-Allow-Origin":"*"}});
  }
  if(method==="POST"||method==="DELETE"){
   if(path.includes("/FavoriteItems/")||path.includes("/PlayedItems/")){
    actions.push({method,path});
    const parts=path.split("/");
    const target=parts.at(-1);
    const state=path.includes("/FavoriteItems/")?favoriteIds:playedIds;
    if(method==="POST")state.add(target);
    else state.delete(target);
    return route.fulfill({status:204,headers:cors,body:""});
   }
  }
  let payload={Items:[]};
  if(path==="/Users/AuthenticateByName"){
   payload={User:{Id:user,Name:"Alice"},AccessToken:token};
  }else if(path==="/Users/Me"){
   payload={Id:user,Name:"Alice",Policy:{IsDisabled:false}};
  }else if(path==="/Users/"+user+"/Views"){
   payload={Items:[
    {Id:id(8100),Name:"Films",CollectionType:"movies"},
    {Id:id(8101),Name:"Séries",CollectionType:"tvshows"},
    {Id:id(8102),Name:"Animes",CollectionType:"tvshows"}
   ]};
  }else if(path==="/UserItems/Resume"){
   payload={Items:films.slice(0,8),TotalRecordCount:8};
  }else if(path==="/Shows/NextUp"){
   const start=Number(qs.get("StartIndex")??0);
   const limit=Number(qs.get("Limit")??300);
   payload={Items:nextUp.slice(start,start+limit),
    TotalRecordCount:nextUp.length};
  }else if(path==="/Users/"+user+"/Items"){
   const kind=qs.get("IncludeItemTypes"),filters=qs.get("Filters");
   const start=Number(qs.get("StartIndex")??0);
   const limit=Number(qs.get("Limit")??96);
   if(qs.has("SearchTerm")){
    const term=qs.get("SearchTerm");
    if(term==="alpha")await new Promise(resolve=>setTimeout(resolve,900));
    payload={Items:[films[term==="alpha"?0:1]],TotalRecordCount:1};
   }else if(kind==="Season"){
    payload={Items:[{Id:id(9000),SeriesId:id(100),IndexNumber:2,
     PremiereDate:"2026-09-15"}],TotalRecordCount:1};
   }else if(kind==="Series"&&qs.get("Ids")){
    const ids=qs.get("Ids").split(",");
    payload={Items:ids.map((sid,n)=>({
     ...films[n],Id:sid,Name:"Série "+(n+1),Type:"Series",
     UserData:{PlayedPercentage:55,Played:false}
    })),TotalRecordCount:ids.length};
   }else if(kind==="BoxSet"){
    payload={Items:[],TotalRecordCount:0};
   }else{
    let candidates=films;
    if(filters==="IsPlayed")candidates=films.slice(0,30);
    else if(filters==="IsFavorite")candidates=films.slice(0,5);
    else if(filters==="IsUnplayed")candidates=films.slice(30);
    else if(kind==="Series")candidates=films.filter(x=>false);
    const parent=qs.get("ParentId");
    if(parent===id(8101)||parent===id(8102))candidates=[];
    payload={Items:candidates.slice(start,start+limit),
     TotalRecordCount:candidates.length};
   }
  }else if(path.startsWith("/Users/"+user+"/Items/")){
   if(path==="/Users/"+user+"/Items/"+id(102))
    return route.fulfill({status:503,headers:cors,body:"Parent temporarily unavailable"});
   const mediaId=path.split("/").at(-1);
   const episode=nextUp.find(ep=>ep.Id===mediaId);
   if(episode)payload={...episode,UserData:{...episode.UserData,
    Played:playedIds.has(mediaId)}};
   else if(seriesIds.includes(mediaId)){
    payload={...films[0],Id:mediaId,Type:"Series",Name:"Série parente",
      UserData:{PlayedPercentage:55,Played:false,
        IsFavorite:favoriteIds.has(mediaId)}};
   }else payload=films.find(f=>f.Id===mediaId)??films[0];
  }
  return route.fulfill({status:200,headers:{"Content-Type":"application/json",
    ...cors},body:bodyJson(payload)});
 });
 const page=await context.newPage();
 page.on("pageerror",e=>errors.push(String(e)));
 await page.goto("http://127.0.0.1:"+port+"/",{waitUntil:"networkidle"});
 await page.locator("#vy-username").fill("Alice");
 await page.locator("#vy-password").fill("fictional-password");
 await page.getByRole("button",{name:"Se connecter"}).click();
 await page.locator(".vy-shelf[aria-label='À suivre'] .vy-card").first()
   .waitFor({timeout:15000});
 await page.waitForFunction(()=>
   document.querySelectorAll(".vy-shelf[aria-label='À suivre'] .vy-card").length>=260);
 const total=await page.locator(".vy-shelf[aria-label='À suivre'] .vy-card").count();
 const shape=await page.locator(".vy-shelf[aria-label='À suivre']").evaluate(el=>({
  total:el.querySelectorAll(".vy-card").length,
  railItems:el.querySelector(".vy-rail")?.children.length,
  nestedSections:el.querySelectorAll(".vy-shelf").length,
  innerHTMLSize:el.innerHTML.length
 }));
 console.log("JELLYFIN_NEXTUP_SHAPE "+JSON.stringify(shape));
 assert(total>=260 && total<=270,"NextUp must retain the full catalog rather than 22 titles");
 assert.equal(await page.locator(".vy-shelves .vy-shelf-count").count(),0);
 await page.getByRole("heading",{name:"Nouvelles saisons et suites"})
   .waitFor({timeout:12000});
 assert.equal(await page.locator(".vy-universe-tile").count(),7);
 assert.equal(await page.locator(".vy-header .vy-nav").getByRole("button",
  {name:"Univers",exact:true}).count(),0,
  "Univers must remain a home rail, never a header tab");
 await page.locator('[data-vy-universe="dcu"] img')
  .evaluate(img=>img.decode());
 const newDcu=await page.locator('[data-vy-universe="dcu"] img')
  .evaluate(img=>({loaded:img.complete&&img.naturalWidth>0,
   filter:getComputedStyle(img).filter}));
 assert(newDcu.loaded && newDcu.filter==="none",
  "New DCU logo must load in its original color");
 console.log("JELLYFIN_PARITY_7_UNIVERSES_AND_HEADER_PASS");
 const search=await page.locator(".vy-search-icon").boundingBox();
 const input=await page.locator(".vy-search-label input").boundingBox();
 assert(search&&input);
 assert(Math.abs(search.y+search.height/2-
   (input.y+input.height/2))<4,"Search icon must align with input");
 const railGeometry=await page.locator(".vy-shelf[aria-label='Reprendre la lecture'] .vy-rail").evaluate(el=>{
  const first=el.querySelector(".vy-card").getBoundingClientRect();
  const rect=el.getBoundingClientRect(),css=getComputedStyle(el);
  return {railLeft:rect.left,scrollLeft:el.scrollLeft,paddingLeft:css.paddingLeft,
    firstLeft:first.left,firstWidth:first.width};
 });
 console.log("JELLYFIN_PARITY_RAIL_GEOMETRY "+JSON.stringify(railGeometry));
 assert(railGeometry.firstLeft>=42 && railGeometry.firstLeft<=75,
    "Initial shelf card must align with the Jellyfin 3.3% outer inset");
 assert(railGeometry.scrollLeft<=4,"Initial rail must not auto-scroll");
 await page.screenshot({path:join(out,"home-1650.png"),fullPage:false});
 for(const viewport of [{width:390,height:844},{width:1280,height:800},
  {width:1920,height:1080}]){
  await page.setViewportSize(viewport);
  await page.waitForTimeout(160);
  const overflow=await page.evaluate(()=>
   document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert(overflow<=2,"Home horizontal overflow "+viewport.width+" "+overflow);
  await page.screenshot({path:join(out,"home-"+viewport.width+".png"),fullPage:false});
 }
 await page.setViewportSize({width:1650,height:930});
 console.log("JELLYFIN_PARITY_HOME_390_1280_1920_PASS nextup="+total);
 const ranked=page.locator(".vy-card-ranking:has(.vy-novelty)").first();
 await ranked.waitFor({timeout:4000});
 const badgeGeometry=await ranked.evaluate(el=>{
  const rank=el.querySelector(".vy-rank").getBoundingClientRect();
  const badge=el.querySelector(".vy-novelty").getBoundingClientRect();
  const overlaps=!(badge.right<=rank.left || badge.left>=rank.right ||
    badge.bottom<=rank.top || badge.top>=rank.bottom);
  return {rankTop:rank.top,badgeBottom:badge.bottom,overlaps};
 });
 assert(!badgeGeometry.overlaps && badgeGeometry.badgeBottom<
   badgeGeometry.rankTop,
   "Top 10 number and new-release badge must occupy separate corners");
 console.log("JELLYFIN_PARITY_TOP10_BADGE_NO_COLLISION_PASS");
 const brokenCard=page.locator(".vy-card[data-vy-card='"+id(1)+"']").first();
 await brokenCard.scrollIntoViewIfNeeded();
 await brokenCard.locator(".vy-card-picture img").waitFor();
 await page.waitForFunction(mediaId=>{
  const img=document.querySelector(".vy-card[data-vy-card='"+mediaId+"'] .vy-card-picture img");
  return img?.dataset.vyArtReady==="false" &&
    !img.hasAttribute("src") && getComputedStyle(img).visibility==="hidden";
 },id(1),{timeout:4500});
 console.log("JELLYFIN_PARITY_CORRUPT_IMAGE_PLACEHOLDER_PASS");
 const card=page.locator(".vy-shelf[aria-label='À suivre'] .vy-card").first();
 await card.scrollIntoViewIfNeeded();
 await card.hover();
 const popup=page.locator(".vy-hover-popup");
 await popup.waitFor({timeout:4000});
 await popup.getByRole("button",{name:"Ajouter à ma liste"}).waitFor({timeout:5000});
 assert.equal(await popup.getByRole("button",
   {name:"Téléchargement bientôt disponible"}).isDisabled(),true);
 const circles=await popup.locator(".vy-icon-button").all();
 for(const circle of circles){
   const button=await circle.boundingBox(),svg=await circle.locator("svg").boundingBox();
   if(!button||!svg)continue;
   assert(Math.abs(button.x+button.width/2-svg.x-svg.width/2)<3);
   assert(Math.abs(button.y+button.height/2-svg.y-svg.height/2)<3);
 }
 await popup.getByRole("button",{name:"Ajouter à ma liste"}).click();
 // The episode heart targets its parent series, never the episode itself.
 const hoveredId=await card.getAttribute("data-vy-card");
 const hoveredEpisode=nextUp.find(ep=>ep.Id===hoveredId);
 assert(hoveredEpisode,"The hovered card must be an episode");
 assert(actions.some(x=>x.method==="POST" &&
   x.path==="/Users/"+user+"/FavoriteItems/"+hoveredEpisode.SeriesId));
 assert(external.some(x=>new URL(x.url).pathname===
   "/Users/"+user+"/Items/"+hoveredEpisode.SeriesId),
   "The hover must read the series favorite state");
 await page.screenshot({path:join(out,"hover-1650.png"),fullPage:false});
 console.log("JELLYFIN_PARITY_HOVER_ACTIONS_PASS");
 await popup.getByRole("button",{name:"Marquer vu"}).click();
 assert(actions.some(x=>x.method==="POST" &&
  x.path==="/Users/"+user+"/PlayedItems/"+hoveredEpisode.Id));
 await page.mouse.move(900,25);
 await popup.waitFor({state:"hidden",timeout:2500});
 const second=page.locator(".vy-shelf[aria-label='À suivre'] .vy-card").nth(1);
 await second.hover();
 await popup.waitFor({timeout:4000});
 const unavailable=popup.getByRole("button",{name:"Favori de la série indisponible"});
 await unavailable.waitFor({timeout:5000});
 assert.equal(await unavailable.isDisabled(),true);
 assert.equal(await popup.getByRole("button",{name:"Marquer vu"}).isEnabled(),true);
 console.log("JELLYFIN_PARITY_HOVER_FAIL_CLOSED_AND_CLOSE_PASS");
 await page.mouse.move(900,25);
 await popup.waitFor({state:"hidden",timeout:2500});
 // Detail actions mutate Jellyfin directly, and episode favorites must
 // always update their parent series rather than the episode.
 await card.scrollIntoViewIfNeeded();
 await card.locator(".vy-card-main").click();
 const detail=page.locator(".vy-detail[role='dialog']");
 await detail.waitFor({timeout:4000});
 await detail.getByRole("button",{name:"Retirer de ma liste"})
   .waitFor({timeout:5000});
 await detail.getByRole("button",{name:"Retirer de ma liste"}).click();
 assert(actions.some(x=>x.method==="DELETE" &&
   x.path==="/Users/"+user+"/FavoriteItems/"+hoveredEpisode.SeriesId));
 await detail.getByRole("button",{name:"Ajouter à ma liste"}).waitFor();
 await detail.getByRole("button",{name:"Marquer non vu"}).click();
 assert(actions.some(x=>x.method==="DELETE" &&
   x.path==="/Users/"+user+"/PlayedItems/"+hoveredEpisode.Id));
 await detail.getByRole("button",{name:"Marquer vu"}).waitFor({timeout:4000});
 await page.screenshot({path:join(out,"media-details-actions-1650.png"),
  fullPage:false});
 await detail.getByRole("button",{name:"Fermer"}).click();
 await detail.waitFor({state:"hidden"});
 console.log("JELLYFIN_PARITY_DETAIL_ACTIONS_PARENT_SAFE_PASS");
 const beforeHide=await page.locator(".vy-shelf[aria-label='À suivre'] .vy-card").count();
 await card.hover();
 await popup.waitFor();
 await popup.getByRole("button",{name:"Masquer de ce rayon sur cet appareil"}).click();
 await page.waitForFunction(expected=>
  document.querySelectorAll(".vy-shelf[aria-label='À suivre'] .vy-card").length===expected,
  beforeHide-1,{timeout:3500});
 await page.getByRole("button",{name:"Ouvrir le profil"}).click();
 await page.getByRole("button",{name:"Réafficher les 1 titres masqués"}).click();
 await page.waitForFunction(expected=>
  document.querySelectorAll(".vy-shelf[aria-label='À suivre'] .vy-card").length===expected,
  beforeHide,{timeout:3000});
 console.log("JELLYFIN_PARITY_RESTORE_HIDDEN_NEXT_UP_PASS");
 // A slow first search must not overwrite newer results or end the spinner.
 const searchInput=page.getByRole("searchbox",{
  name:"Rechercher dans ma bibliothèque"});
 await searchInput.fill("alpha");
 await page.waitForTimeout(340);
 await searchInput.fill("beta");
 await page.locator(".vy-browser .vy-card-title").first()
  .getByText("Film de test 2",{exact:true}).waitFor({timeout:5000});
 await page.waitForTimeout(1100);
 assert.equal(await page.locator(".vy-browser .vy-card-title").first()
   .textContent(),"Film de test 2");
 assert.equal(await page.locator(".vy-browser .vy-card").count(),1);
 await searchInput.fill("");
 await page.locator(".vy-shelf[aria-label='À suivre']").waitFor();
 console.log("JELLYFIN_PARITY_SEARCH_RACE_PASS");
 const arrow=page.getByRole("button",{name:"Défiler À suivre vers la droite"});
 await arrow.waitFor({timeout:3000});
 const rail=page.locator(".vy-shelf[aria-label='À suivre'] .vy-rail");
 const prior=await rail.evaluate(x=>x.scrollLeft);
 await arrow.click();
 await page.waitForTimeout(600);
 assert((await rail.evaluate(x=>x.scrollLeft))>prior);
 console.log("JELLYFIN_PARITY_CAROUSEL_ARROW_PASS");
 await page.getByRole("button",{name:"Explorer l'univers Pixar"}).click();
 await page.getByRole("button",{name:/Tous les univers/}).click();
 await page.locator(".vy-universe-tile").first().waitFor();
 assert.equal(await page.locator(".vy-universe-tile").count(),7);
 assert.equal(await page.locator(".vy-universes-page h1").count(),1);
 const universeLeft=await page.locator(".vy-universes-page .vy-universe-tile")
   .first().evaluate(el=>el.getBoundingClientRect().left);
 console.log("JELLYFIN_PARITY_UNIVERSE_LEFT "+universeLeft);
 assert(universeLeft>=42 && universeLeft<=75,
   "Universe tiles should align with the content heading");
 await page.screenshot({path:join(out,"universe-tiles-1650.png"),fullPage:false});
 await page.getByRole("button",{name:"Explorer l'univers Pixar"}).click();
 await page.locator(".vy-universes-page .vy-catalog-grid .vy-card").first()
   .waitFor({timeout:10000});
 await page.waitForTimeout(1700);
 const artStatus=await page.locator(".vy-universes-page .vy-card img")
   .evaluateAll(imgs=>({total:imgs.length,loaded:imgs.filter(img=>img.complete&&img.naturalWidth>0).length,
     broken:imgs.filter(img=>img.complete&&img.naturalWidth===0&&!!img.src).length}));
 console.log("JELLYFIN_PARITY_IMAGE_STATUS "+JSON.stringify(artStatus));
 await page.screenshot({path:join(out,"universes-1650.png"),fullPage:false});
 console.log("JELLYFIN_PARITY_UNIVERSE_JELLYFIN_SCOPE_PASS");
 assert(external.every(x=>!x.url.includes(token)));
 assert.equal(errors.length,0,"Unexpected browser errors: "+errors.join("; "));
 for(const viewport of [{width:390,height:844},{width:1280,height:800},
  {width:1920,height:1080}]){
  await page.setViewportSize(viewport);
  await page.waitForTimeout(180);
  if(viewport.width===390){
   const navVisibility=await page.locator(".vy-header .vy-nav").evaluate(nav=>{
    const selected=nav.querySelector('[aria-current="page"]');
    const host=nav.getBoundingClientRect(),item=selected.getBoundingClientRect();
    return {label:selected.textContent,hostRight:host.right,activeRight:item.right,
     hostLeft:host.left,activeLeft:item.left};
   });
   assert(navVisibility.label==="Accueil" &&
     navVisibility.activeRight<=navVisibility.hostRight+2 &&
     navVisibility.activeLeft>=navVisibility.hostLeft-2,
    "Navigation remains on Accueil when viewing Univers: "+JSON.stringify(navVisibility));
   console.log("JELLYFIN_PARITY_ACTIVE_MOBILE_TAB_PASS "+
    JSON.stringify(navVisibility));
  }
  const overflow=await page.evaluate(()=>
   document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert(overflow<=2,"Horizontal overflow "+viewport.width+" "+overflow);
  await page.screenshot({path:join(out,"universe-"+viewport.width+".png"),
   fullPage:false});
 }
 console.log("JELLYFIN_PARITY_NO_OVERFLOW_390_1280_1920_PASS");
}finally{
 await browser?.close();
 await new Promise(resolve=>http.close(resolve));
}