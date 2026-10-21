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
export function htmlVideoFailureMessage(code:number|null):string{
  if(code===3 || code===4)
    return "WebView2 ne parvient pas à décoder cette source vidéo.";
  if(code===2)
    return "Le flux vidéo a rencontré une erreur réseau.";
  return "Le flux vidéo est indisponible. Réessayez.";
}
