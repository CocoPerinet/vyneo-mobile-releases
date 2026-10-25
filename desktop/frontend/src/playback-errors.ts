import type {PlaybackProbe} from "./types";

/** No server URLs, raw error strings or bearer tokens may appear in the UI.
 * Pure, fixed-text troubleshooting messages are safe to share in QA. */
export function unavailablePlaybackMessage(probe:PlaybackProbe):string{
  if(probe.errorCode==="NotAllowed")
    return "Ce compte Jellyfin n'est pas autorisé à lire ce média. "+
      "Vérifiez les autorisations de lecture dans Jellyfin.";
  if(probe.errorCode==="RateLimitExceeded")
    return "Jellyfin limite actuellement les lectures ou transcodages "+
      "simultanés. Réessayez quand le serveur est moins occupé.";
  if(probe.errorCode==="NoCompatibleStream")
    return "Jellyfin n'a proposé aucun flux compatible avec ce lecteur.";
  const known=probe.sources.filter(source=>source.id!==null);
  if(known.some(source=>source.isRemote &&
    !source.transcoding && !source.directStream))
    return "Cette source distante nécessite une lecture via Jellyfin, "+
      "mais le compte ne dispose pas d'un transcodage compatible.";
  if(known.some(source=>source.transcoding))
    return "Jellyfin autorise le transcodage, mais aucune URL HLS "+
      "compatible n'a été négociée. Vérifiez le profil du serveur.";
  if(known.length===0)
    return "Jellyfin n'a retourné aucune source vidéo utilisable.";
  return "Aucun flux MP4 local ou HLS distant compatible n'est disponible.";
}
export function nativeHlsFailureMessage(
  kind:string,details:string
):string{
  // Do not interpolate the details text. It may contain a URL/token.
  if(kind==="networkError" || /(?:Load|Timeout|TimeOut)Error$/.test(details))
    return "Jellyfin n'a pas pu fournir le flux HLS ou ses segments. "+
      "Vérifiez la connexion, les droits du compte et le transcodage.";
  if(kind==="mediaError" || /(?:fragParsing|bufferIncompatible|Codec)/i.test(details))
    return "Le flux HLS a été reçu, mais WebView2 n'a pas pu "+
      "décoder correctement la vidéo ou l'audio.";
  return "Le lecteur HLS s'est interrompu. "+
    "Essayez un autre média et vérifiez les journaux Jellyfin.";
}
/** Only the non-distributable QA proxy emits this fixed diagnostic header.
 * A transient HTTP 502 may recover before hls.js reports a fatal error.
 * Extract bounded codes from its XHR, Fetch response or loader without
 * ever serializing URLs, response bodies, tokens or raw exception messages. */
const SAFE_HLS_QA_REASONS=new Set([
  "HLS_UPSTREAM_NETWORK","HLS_UPSTREAM_HTTP_STATUS",
  "HLS_UPSTREAM_MEDIA_TYPE","HLS_UPSTREAM_BODY",
  "HLS_UPSTREAM_OVERSIZE_PLAYLIST",
  "HLS_UPSTREAM_OVERSIZE_16_TO_32_MIB",
  "HLS_UPSTREAM_OVERSIZE_32_TO_64_MIB",
  "HLS_UPSTREAM_OVERSIZE_64_TO_512_MIB",
  "HLS_UPSTREAM_OVERSIZE_OVER_512_MIB",
  "HLS_MANIFEST_ENCODING","HLS_INVALID_MANIFEST",
  "HLS_ASSET_STATE","HLS_ASSET_LIMIT","HLS_BAD_REQUEST",
  "HLS_TOO_MANY_REQUESTS","HLS_FORBIDDEN",
  "HLS_ENCRYPTION_UNSUPPORTED","HLS_UNSUPPORTED_BYTERANGE",
  "HLS_INTERNAL_SERVER_ERROR","HLS_RESPONSE_BUILD"
]);
const object=(value:unknown):Record<string,unknown>|null=>
  value!==null && typeof value==="object"
    ?value as Record<string,unknown>:null;
function reasonHeader(value:unknown):string|null{
  const entry=object(value);
  if(!entry)return null;
  let raw:unknown;
  try{
    if(typeof entry.getResponseHeader==="function")
      raw=entry.getResponseHeader("x-vyneo-qa-hls-reason");
    if(raw===undefined || raw===null){
      const headers=object(entry.headers);
      if(headers && typeof headers.get==="function")
        raw=headers.get("x-vyneo-qa-hls-reason");
    }
  }catch{return null;}
  return typeof raw==="string" && SAFE_HLS_QA_REASONS.has(raw)
    ?raw:null;
}
export function nativeHlsQaDiagnostic(data:unknown):string|null{
  const row=object(data);
  if(!row || row.type!=="networkError")return null;
  const response=object(row.response);
  const rawStatus=response?.code;
  const status=typeof rawStatus==="number" &&
    Number.isSafeInteger(rawStatus) && rawStatus>=400 && rawStatus<=599
    ?rawStatus:null;
  const reason=reasonHeader(row.networkDetails)??reasonHeader(row.loader);
  if(!reason && status===null)return null;
  return reason?(reason+(status!==null?" (HTTP "+status+")":""))
    :"HTTP "+status;
}

export function htmlVideoFailureMessage(code:number|null):string{
  if(code===3 || code===4)
    return "WebView2 ne parvient pas à décoder cette source vidéo.";
  if(code===2)
    return "Le flux vidéo a rencontré une erreur réseau.";
  return "Le flux vidéo est indisponible. Réessayez.";
}


// Never display an upstream exception verbatim: it may contain a signed
// media URL, HTTP headers or a Jellyfin token. Each reason is a fixed code.
export function playbackInspectionErrorMessage(error:unknown):string{
  const code=error instanceof Error?error.message:error;
  if(code==="REQUEST_TIMEOUT")
    return "Jellyfin a mis trop de temps à analyser ce média. "+
      "Réessayez : le premier accès à un fichier STRM peut être plus lent.";
  if(code==="SESSION_EXPIRED")
    return "La session Jellyfin a expiré. Reconnectez-vous avant de "+
      "vérifier les formats.";
  if(code==="NETWORK_UNAVAILABLE")
    return "Impossible de joindre Jellyfin pour analyser ce média. "+
      "Vérifiez la connexion puis réessayez.";
  if(code==="REQUEST_DENIED")
    return "Jellyfin n'a pas pu fournir les informations du média "+
      "(accès refusé ou erreur du serveur).";
  if(code==="PLAYBACK_INFO_INVALID" || code==="RESPONSE_INVALID" ||
     code==="RESPONSE_TOO_LARGE")
    return "Jellyfin a renvoyé des informations techniques non "+
      "exploitables pour ce média.";
  return "Informations techniques indisponibles pour ce média.";
}
