import {invoke,isTauri} from "@tauri-apps/api/core";

export type UpdateOutcome="up-to-date"|"declined"|"install-started";
type Invoke=(name:string,args?:Record<string,unknown>)=>Promise<unknown>;
/**
 * Renderer can only request the existing, signature-enforced native updater.
 * It cannot choose a manifest, download URL, version or signing key.
 */
export class NativeUpdater {
  constructor(private call:Invoke=invoke,
    readonly available:boolean=isTauri()){}
  async check():Promise<UpdateOutcome>{
    if(!this.available)throw new Error("UPDATE_REQUIRES_DESKTOP");
    const result=await this.call("check_signed_update_now");
    if(result==="up-to-date" || result==="declined" ||
      result==="install-started")return result;
    throw new Error("UPDATE_INVALID_RESPONSE");
  }
}
export const nativeUpdater=new NativeUpdater();
export function updateNotice(result:UpdateOutcome):string{
  if(result==="up-to-date")return "Vynéo est à jour.";
  if(result==="declined")return "Mise à jour reportée.";
  return "Installation de la mise à jour signée en cours.";
}
export function updateFailure(error:unknown):string{
  const code=error instanceof Error?error.message:error;
  if(code==="UPDATE_DISABLED_IN_QA")
    return "Mises à jour désactivées dans cette version temporaire de test.";
  if(code==="UPDATE_BUSY")return "Une vérification est déjà en cours.";
  if(code==="UPDATE_CHECK_TIMEOUT" || code==="UPDATE_DOWNLOAD_TIMEOUT")
    return "Délai dépassé. Réessayez plus tard.";
  if(code==="UPDATE_CHECK_FAILED" || code==="UPDATE_DOWNLOAD_FAILED")
    return "Le serveur de mises à jour est indisponible. Réessayez plus tard.";
  if(code==="UPDATE_INSTALL_FAILED")
    return "Installation impossible. La version actuelle reste disponible.";
  return "Vérification impossible. Réessayez plus tard.";
}
