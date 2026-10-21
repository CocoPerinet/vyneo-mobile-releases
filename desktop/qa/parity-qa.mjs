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
const visualReference=JSON.parse(readFileSync(join(root,"desktop",
  "parity","reference-geometry.json"),"utf8"));
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
// The Jellyfin injector uses TVDbCollection for coherent series spin-offs.
 // Simulate two watched titles and one newly released derivative, not a
 // random "best-of" playlist sharing the same provider collection ID.
for(const index of [0,1,35]){
 films[index].Tags=["Saga continue"];
 films[index].ProviderIds.TvdbCollection="8541; 902";
}
// Historical titles prove that an authorized Pixar universe is grouped
// into decades rather than displayed in the former undifferentiated grid.
for(const [index,year] of [[30,2014],[32,2005]]){
 films[index].ProductionYear=year;
 films[index].PremiereDate=year+"-06-15";
}
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
   // Resume has genuine partial playback; the prior QA accidentally
   // served eight already-watched films and hid the missing-stale fix.
   const partial=films.slice(0,8).map((film,n)=>({
    ...film,RunTimeTicks:100000000000,
    UserData:{...film.UserData,Played:false,
     PlaybackPositionTicks:(n+1)*8000000000}
   }));
   const stale={...films[8],RunTimeTicks:100000000000,
    UserData:{...films[8].UserData,Played:false,
     PlaybackPositionTicks:99000000000}};
   payload={Items:[...partial,stale],TotalRecordCount:9};
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
 const resumeCardIds=await page.locator(
  ".vy-shelf[aria-label='Reprendre la lecture'] .vy-card"
 ).evaluateAll(cards=>cards.map(card=>card.dataset.vyCard));
 assert.equal(resumeCardIds.length,8);
 assert(!resumeCardIds.includes(id(9)),
  "A stale 99%-finished .strm must never remain in Resume");
 console.log("JELLYFIN_PARITY_RESUME_FILTERS_STALE_99PCT_PASS");
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
 await page.locator(
  '.vy-shelf[aria-label="Nouvelles saisons et suites"] '+
  '.vy-card[data-vy-card="'+id(36)+'"]'
 ).waitFor({timeout:12000});
 console.log("JELLYFIN_PARITY_TVDB_COHESIVE_SPINOFF_VISIBLE_PASS");
 // The old script always captured the scrolled Univers row, not the Hero:
 // keep a deterministic top-of-home screenshot for Block D side-by-side QA.
 await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
 await page.waitForTimeout(180);
 await page.screenshot({path:join(out,"home-hero-1650.png"),fullPage:false});
 const heroTitle=await page.locator(".vy-hero h1").textContent();
 const heroDots=page.locator(".vy-hero-dots button");
 assert((await heroDots.count())>=2,"Hero carousel needs multiple slides");
 await page.getByRole("button",{name:"Bannière suivante"}).click();
 await page.waitForFunction(before=>
  document.querySelector(".vy-hero h1")?.textContent!==before,heroTitle);
 await page.getByRole("button",{name:"Bannière précédente"}).click();
 await page.waitForFunction(before=>
  document.querySelector(".vy-hero h1")?.textContent===before,heroTitle);
 const heroCenter=await page.locator(".vy-hero-dots").evaluate(el=>{
  const hero=document.querySelector(".vy-hero").getBoundingClientRect();
  const dots=el.getBoundingClientRect();
  return Math.abs((dots.left+dots.right)/2-(hero.left+hero.right)/2);
 });
 assert(heroCenter<=2,"Hero indicator row must be centered");
 console.log("JELLYFIN_PARITY_HERO_SLIDES_NAVIGATION_PASS");
 assert.equal(await page.locator(".vy-universe-tile").count(),7);
 assert.equal(await page.locator(".vy-header .vy-nav").getByRole("button",
  {name:"Univers",exact:true}).count(),0,
  "Univers must remain a home rail, never a header tab");
 // The final logo is lazy, far beyond the right edge of the carousel.
 // Scroll it into view before waiting, rather than awaiting decode()
 // indefinitely while Chromium defers the off-screen resource.
 await page.locator('[data-vy-universe="dcu"]').scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>{
  const img=document.querySelector('[data-vy-universe="dcu"] img');
  return img?.complete && img.naturalWidth>0;
 },null,{timeout:4500});
 const newDcu=await page.locator('[data-vy-universe="dcu"] img')
  .evaluate(img=>({loaded:img.complete&&img.naturalWidth>0,
   filter:getComputedStyle(img).filter}));
 assert(newDcu.loaded && newDcu.filter==="none",
  "New DCU logo must load in its original color");
 const logoGeometry=await page.locator(".vy-universe-tile").evaluateAll(tiles=>
  tiles.map(tile=>{
   const tileRect=tile.getBoundingClientRect();
   const imgRect=tile.querySelector("img").getBoundingClientRect();
   return {id:tile.dataset.vyUniverse,
    inside:imgRect.top>=tileRect.top-1 &&
      imgRect.bottom<=tileRect.bottom+1 &&
      imgRect.left>=tileRect.left-1 &&
      imgRect.right<=tileRect.right+1};
  }));
 assert(logoGeometry.every(x=>x.inside),
  "Universe logos must fit entirely inside their cards: "+
  JSON.stringify(logoGeometry));
 console.log("JELLYFIN_PARITY_UNIVERSE_LOGOS_FIT_PASS");
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
 // Audit's Block A: measure the actual rendered Desktop against the exact
 // CSS values from the original Jellyfin skin at the same 1650×930 viewport.
 const metrics=await page.evaluate(()=>{
  const css=(selector)=>getComputedStyle(document.querySelector(selector));
  return {
   headerHeight:document.querySelector(".vy-header").getBoundingClientRect().height,
   navFont:parseFloat(css(".vy-nav button").fontSize),
   navRadius:parseFloat(css(".vy-nav button").borderTopLeftRadius),
   searchHeight:document.querySelector(".vy-search-label").getBoundingClientRect().height,
   searchWidth:document.querySelector(".vy-search-label").getBoundingClientRect().width,
   searchFont:parseFloat(css(".vy-search-label input").fontSize),
   heroMinHeight:parseFloat(css(".vy-hero").minHeight),
   shelfMargin:parseFloat(css(".vy-shelves").marginTop),
   cardWidth:document.querySelector(".vy-shelf .vy-card").getBoundingClientRect().width,
   railGap:parseFloat(css(".vy-shelf .vy-rail").gap),
   sectionHeadingFont:parseFloat(css(".vy-shelf-heading h2").fontSize)
  };
 });
 const approximate=(a,b,delta=1)=>Math.abs(a-b)<=delta;
 assert(approximate(metrics.headerHeight,visualReference.header.minHeightPx,2),
  "Header height differs from Jellyfin CSS: "+JSON.stringify(metrics));
 assert(approximate(metrics.navFont,visualReference.header.navFontPx,.25));
 assert(metrics.navRadius>=visualReference.header.navPillRadiusMinPx);
 assert(approximate(metrics.searchHeight,visualReference.header.searchHeightPx,1));
 assert(approximate(metrics.searchWidth,visualReference.header.searchWidthPx,1));
 assert(approximate(metrics.searchFont,visualReference.header.searchInputFontPx,.25));
 assert(approximate(metrics.heroMinHeight,Math.min(
  visualReference.hero.minHeightVh/100*visualReference.viewport.height,
  visualReference.hero.maxHeightPx),2));
 assert(approximate(metrics.shelfMargin,-visualReference.hero.shelfOverlapPx,1));
 assert(approximate(metrics.cardWidth,visualReference.rails.cardWidthPx,1));
 assert(approximate(metrics.railGap,visualReference.rails.gapPx,1));
 assert(approximate(metrics.sectionHeadingFont,
  visualReference.rails.headingFontPx,.25));
 console.log("JELLYFIN_PARITY_SOURCE_GEOMETRY_PASS "+JSON.stringify(metrics));
 assert(railGeometry.scrollLeft<=4,"Initial rail must not auto-scroll");
 await page.screenshot({path:join(out,"home-1650.png"),fullPage:false});
 for(const viewport of [{width:390,height:844},{width:1280,height:800},
  {width:1920,height:1080}]){
  await page.setViewportSize(viewport);
  await page.waitForTimeout(160);
  const overflow=await page.evaluate(()=>
   document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert(overflow<=2,"Home horizontal overflow "+viewport.width+" "+overflow);
  if(viewport.width>=1200){
   const responsive=await page.evaluate(()=>{
    const css=selector=>getComputedStyle(document.querySelector(selector));
    return {search:document.querySelector(".vy-search-label").getBoundingClientRect().width,
     header:document.querySelector(".vy-header").getBoundingClientRect().height,
     heroMin:parseFloat(css(".vy-hero").minHeight),
     card:document.querySelector(".vy-shelf .vy-card").getBoundingClientRect().width};
   });
   assert(Math.abs(responsive.header-visualReference.header.minHeightPx)<=2);
   assert(Math.abs(responsive.search-Math.min(320,viewport.width*.2))<=1);
   assert(Math.abs(responsive.heroMin-Math.min(
    viewport.height*.78,visualReference.hero.maxHeightPx))<=2);
   assert(Math.abs(responsive.card-visualReference.rails.cardWidthPx)<=1);
   console.log("JELLYFIN_PARITY_SOURCE_RESPONSIVE_"+viewport.width+"_PASS "+
    JSON.stringify(responsive));
  }
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
 await brokenCard.locator(".vy-card-picture img")
  .waitFor({state:"attached",timeout:4000});
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
 // Wait for the real 140ms entrance animation. During scale(.97),
 // getBoundingClientRect() is deliberately smaller than its CSS width.
 await popup.evaluate(el=>Promise.all(el.getAnimations().map(animation=>
  animation.finished.catch(()=>{}))));
 const hoverDimensions=await popup.evaluate(el=>{
  const button=el.querySelector(".vy-icon-primary");
  return {width:el.getBoundingClientRect().width,
    actionWidth:button.getBoundingClientRect().width};
 });
 console.log("JELLYFIN_PARITY_HOVER_MEASURE "+JSON.stringify(hoverDimensions));
 assert(approximate(hoverDimensions.width,visualReference.hover.widthPx,1));
 assert(approximate(hoverDimensions.actionWidth,
  visualReference.hover.actionDiameterPx,1));
 console.log("JELLYFIN_PARITY_HOVER_SOURCE_GEOMETRY_PASS "+
   JSON.stringify(hoverDimensions));
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
 // The original audit required a keyboard-operable hover card, not merely a
 // mouse popup. ArrowDown opens and focuses actions; Escape restores focus.
 const keyboardCard=page.locator(".vy-shelf[aria-label='À suivre'] .vy-card").nth(3);
 await keyboardCard.scrollIntoViewIfNeeded();
 const keyboardButton=keyboardCard.locator(".vy-card-main");
 await keyboardButton.focus();
 await keyboardButton.press("ArrowDown");
 await popup.waitFor({timeout:3500});
 await page.waitForFunction(()=>
  document.activeElement?.matches(".vy-hover-popup .vy-icon-primary"),null,
  {timeout:2500});
 const hoverBounds=await popup.boundingBox();
 assert(hoverBounds && hoverBounds.x>=13 &&
  hoverBounds.x+hoverBounds.width<=1650-13 &&
  hoverBounds.y>=14 && hoverBounds.y+hoverBounds.height<=930,
  "Keyboard popup must stay on-screen");
 await page.keyboard.press("Tab");
 assert.equal(await popup.evaluate(el=>el.contains(document.activeElement)),true,
  "Tab must reach another popup action");
 await page.keyboard.press("Escape");
 await popup.waitFor({state:"hidden",timeout:2500});
 assert.equal(await keyboardButton.evaluate(el=>el===document.activeElement),true,
  "Escape must restore focus to the initiating card");
 console.log("JELLYFIN_PARITY_HOVER_KEYBOARD_ESCAPE_PASS");
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
 // Block A keyboard: ArrowRight/Left must move focus to actual media cards,
 // including cards initially outside the visible carousel viewport.
 const keyboardRail=page.locator(".vy-shelf[aria-label='À suivre'] .vy-rail");
 const buttons=keyboardRail.locator(".vy-card-main");
 await buttons.first().focus();
 await page.keyboard.press("ArrowRight");
 assert.equal(await buttons.nth(1).evaluate(el=>el===document.activeElement),
  true,"ArrowRight must focus the following title");
 for(let i=0;i<5;i++)await page.keyboard.press("ArrowRight");
 await page.waitForTimeout(400);
 assert.equal(await buttons.nth(6).evaluate(el=>el===document.activeElement),
  true,"Keyboard navigation must pass the first viewport");
 assert((await keyboardRail.evaluate(el=>el.scrollLeft))>0,
  "Keyboard navigation must scroll its rail to the focused item");
 await page.keyboard.press("ArrowLeft");
 assert.equal(await buttons.nth(5).evaluate(el=>el===document.activeElement),
  true,"ArrowLeft must return focus to the previous title");
 console.log("JELLYFIN_PARITY_RAIL_KEYBOARD_NAV_PASS");
 // Original Jellyfin: Universe tiles live in a rail; clicking one opens a
 // centered modal above Home without changing the route or Home scroll.
 const pixarTile=page.getByRole("button",{name:"Explorer l'univers Pixar"});
 await pixarTile.scrollIntoViewIfNeeded();
 assert.equal(await page.locator(".vy-universe-tile").count(),7);
 const universeLeft=await page.locator(".vy-universe-tile")
   .first().evaluate(el=>el.getBoundingClientRect().left);
 console.log("JELLYFIN_PARITY_UNIVERSE_LEFT "+universeLeft);
 assert(universeLeft>=42 && universeLeft<=75,
  "Universe tiles must align with Home's content heading");
 await page.screenshot({path:join(out,"universe-tiles-1650.png"),fullPage:false});
 const backgroundScroll=await page.evaluate(()=>window.scrollY);
 await pixarTile.click();
 const dialog=page.getByRole("dialog",{name:"Pixar"});
 await dialog.waitFor({timeout:3500});
 assert.equal(await page.locator(".vy-header .vy-nav [aria-current=page]")
   .textContent(),"Accueil","Universe modal must not replace the Home tab");
 assert.equal(await page.evaluate(()=>document.body.style.overflow),"hidden");
 assert.equal(await dialog.locator(".vy-universe-page-logo").count(),1);
 assert.equal(await dialog.locator("h1").count(),0,
  "Jellyfin displays only the universe logo, never duplicated text");
 await dialog.locator(".vy-universe-entry").first().waitFor({timeout:10000});
 const tabs=dialog.locator(".vy-universe-tabs [role=tab]");
 assert.deepEqual(await tabs.allTextContents(),
  ["Années 2000","Années 2010","Années 2020"],
  "Universe tabs must follow the original Jellyfin decade grouping");
 assert.equal(await dialog.locator(".vy-universe-entry").count(),1);
 await tabs.nth(1).click();
 assert.equal(await dialog.locator(".vy-universe-entry").count(),1);
 await tabs.nth(2).click();
 assert((await dialog.locator(".vy-universe-entry").count())>100);
 await tabs.nth(1).focus();
 await page.keyboard.press("ArrowLeft");
 assert.equal(await tabs.nth(0).getAttribute("aria-selected"),"true");
 await page.keyboard.press("End");
 assert.equal(await tabs.nth(2).getAttribute("aria-selected"),"true");
 const candidate=page.locator(
  '.vy-universe-entry:has(button[aria-label="Ajouter à ma liste"]):has(button[aria-label="Marquer vu"])'
 ).first();
 const firstId=await candidate.getAttribute("data-vy-universe-item");
 assert(firstId,"A mutable universe action requires an item identity");
 // The action changes its own aria-label; anchor all subsequent checks
 // to the immutable media ID, not to the pre-mutation button state.
 const first=page.locator(
  '.vy-universe-entry[data-vy-universe-item="'+firstId+'"]'
 );
 await first.getByRole("button",{name:"Ajouter à ma liste"}).click();
 assert(actions.some(x=>x.method==="POST" &&
  x.path==="/Users/"+user+"/FavoriteItems/"+firstId));
 await first.getByRole("button",{name:"Retirer de ma liste"})
  .waitFor({timeout:3000});
 await first.getByRole("button",{name:"Marquer vu"}).click();
 assert(actions.some(x=>x.method==="POST" &&
  x.path==="/Users/"+user+"/PlayedItems/"+firstId));
 await first.getByRole("button",{name:"Marquer non vu"})
  .waitFor({timeout:3000});
 await page.waitForTimeout(750);
 const artStatus=await dialog.locator(".vy-universe-entry img")
   .evaluateAll(imgs=>({total:imgs.length,
     loaded:imgs.filter(img=>img.complete&&img.naturalWidth>0).length,
     broken:imgs.filter(img=>img.complete&&img.naturalWidth===0&&!!img.src).length}));
 assert.equal(artStatus.broken,0);
 console.log("JELLYFIN_PARITY_IMAGE_STATUS "+JSON.stringify(artStatus));
 await page.screenshot({path:join(out,"universes-1650.png"),fullPage:false});
 console.log("JELLYFIN_PARITY_UNIVERSE_CHRONOLOGY_AND_ACTIONS_PASS");
 // Opening an item from the universe must return to the same modal/tab and
 // restore keyboard focus when the details overlay is closed.
 await first.getByRole("button",{name:/Voir la fiche de/}).click();
 await page.locator(".vy-detail-screen").waitFor({timeout:3500});
 await page.keyboard.press("Escape");
 await page.locator(".vy-detail-screen").waitFor({state:"hidden",timeout:3000});
 await dialog.waitFor();
 assert.equal(await tabs.nth(2).getAttribute("aria-selected"),"true");
 await page.waitForFunction(id=>{
  const element=document.querySelector(
    '[data-vy-universe-item="'+id+'"] .vy-universe-main');
  return element===document.activeElement;
 },firstId,{timeout:2500});
 console.log("JELLYFIN_PARITY_UNIVERSE_DETAIL_RETURN_FOCUS_PASS");
 const modalClose=dialog.getByRole("button",{name:"Fermer l'univers"});
 await modalClose.focus();
 await page.keyboard.press("Shift+Tab");
 assert(await dialog.evaluate(el=>el.contains(document.activeElement)),
  "Shift+Tab from modal close must wrap to the last dialog control");
 assert.equal(await modalClose.evaluate(el=>el===document.activeElement),false);
 await page.keyboard.press("Tab");
 assert.equal(await modalClose.evaluate(el=>el===document.activeElement),true,
  "Tab from last dialog control must wrap to the close button");
 console.log("JELLYFIN_PARITY_UNIVERSE_MODAL_FOCUS_TRAP_PASS");
 // Dismiss and reopen without resetting the home rail position.
 await page.keyboard.press("Escape");
 await dialog.waitFor({state:"hidden",timeout:2500});
 await page.waitForFunction(()=>
  document.activeElement?.matches(
    '.vy-universe-tile[data-vy-universe="pixar"]'),null,{timeout:2500});
 const scrollAfter=await page.evaluate(()=>window.scrollY);
 assert(Math.abs(scrollAfter-backgroundScroll)<=3,
  "Closing the universe modal must restore exact Home scroll");
 await pixarTile.click();
 await dialog.waitFor();
 await dialog.locator(".vy-universe-entry").first().waitFor({timeout:10000});
 await tabs.nth(2).click();
 console.log("JELLYFIN_PARITY_UNIVERSE_MODAL_AND_HOME_SCROLL_PASS");
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
  const modalGeometry=await dialog.evaluate(el=>{
   const rect=el.getBoundingClientRect();
   const viewport=document.documentElement.clientWidth;
   return {x:rect.left,right:rect.right,width:rect.width,
     height:rect.height,viewWidth:viewport};
  });
  assert(modalGeometry.x>=0 && modalGeometry.right<=viewport.width+1,
   "Universe modal panel exceeds viewport "+JSON.stringify(modalGeometry));
  const overflow=await page.evaluate(()=>
   document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert(overflow<=2,"Horizontal overflow "+viewport.width+" "+overflow);
  await page.screenshot({path:join(out,"universe-"+viewport.width+".png"),
   fullPage:false});
 }
 console.log("JELLYFIN_PARITY_NO_OVERFLOW_390_1280_1920_PASS");
 await page.locator(".vy-universe-backdrop").click({position:{x:6,y:6}});
 await dialog.waitFor({state:"hidden",timeout:2500});
 assert.equal(await page.evaluate(()=>document.body.style.overflow),"",
  "Closing the universe must restore normal Home page scrolling");
 console.log("JELLYFIN_PARITY_UNIVERSE_BACKDROP_CLOSE_PASS");
}finally{
 await browser?.close();
 await new Promise(resolve=>http.close(resolve));
}