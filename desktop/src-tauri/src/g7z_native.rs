//! G7z native bridge. Tauri commands never return Access/OAuth/G7z secrets.
//! The signed Access subject and the Jellyfin G7h cookie are checked by BFF.
use crate::g7z_oauth::{self,OAuthGrant};
use keyring::{Entry,Error as KeyringError};
use serde_json::{json,Value};
use std::sync::atomic::{AtomicU64,Ordering};
use std::sync::Mutex;
use tauri::{AppHandle,Manager,State};
use tokio::sync::Mutex as AsyncMutex;

#[derive(Default)]
pub struct Bridge{
    generation:AtomicU64,
    network:AsyncMutex<()>,
    pending:Mutex<Option<Pending>>,
}
struct Pending{
    user_id:String,
    verifier:String,
    nonce:String,
    link_id:String,
    generation:u64,
}
struct Stored{
    user_id:String,
    oauth:OAuthGrant,
    native_token:String,
    native_expiry:u64,
}
fn denied()->String{"G7Z_NATIVE_DENIED".into()}
fn guid(id:&str)->bool{
    id.len()==32 && id.bytes().all(|b|b.is_ascii_hexdigit())
}
fn hex64(id:&str)->bool{
    id.len()==64 && id.bytes().all(|b|b.is_ascii_hexdigit())
}
fn b64(value:&str)->bool{
    value.len()==43 && value.bytes().all(|b|
        b.is_ascii_alphanumeric() || matches!(b,b'_'|b'-'))
}
fn vault(app:&AppHandle)->Result<Entry,String>{
    let scope=match app.config().identifier.as_str(){
        "fr.visyren.vyneo.desktop"=>"fr.visyren.vyneo.desktop.g7z",
        "fr.visyren.vyneo.desktop.preview"=>
            "fr.visyren.vyneo.desktop.preview.g7z",
        _=>return Err(denied()),
    };
    Entry::new(scope,"native-access-user")
        .map_err(|_|"G7Z_VAULT_UNAVAILABLE".into())
}
impl Stored{
    fn pack(&self)->Value{
        json!({
            "userId":self.user_id,
            "clientId":self.oauth.client_id,
            "accessToken":self.oauth.access_token,
            "refreshToken":self.oauth.refresh_token,
            "tokenEndpoint":self.oauth.token_url,
            "accessExpiry":self.oauth.access_expiry,
            "nativeToken":self.native_token,
            "nativeExpiry":self.native_expiry
        })
    }
    fn parse(value:&Value)->Result<Self,String>{
        let obj=value.as_object().ok_or_else(denied)?;
        if obj.len()!=8{return Err(denied());}
        let get=|key:&str|->Result<String,String>{
            let v=value.get(key).and_then(Value::as_str).ok_or_else(denied)?;
            if v.len()>8192 || v.bytes().any(|b|b<33 || b>126){
                return Err(denied());
            }
            Ok(v.to_string())
        };
        let user_id=get("userId")?;
        let client_id=get("clientId")?;
        let access_token=get("accessToken")?;
        let refresh_token=get("refreshToken")?;
        let token_url=get("tokenEndpoint")?;
        let native_token=get("nativeToken")?;
        let access_expiry=value.get("accessExpiry")
            .and_then(Value::as_u64).ok_or_else(denied)?;
        let native_expiry=value.get("nativeExpiry")
            .and_then(Value::as_u64).ok_or_else(denied)?;
        if !guid(&user_id) || client_id.is_empty() || access_token.is_empty()
            || (!native_token.is_empty() && !hex64(&native_token))
            || g7z_oauth::endpoint(&token_url).is_err()
            || access_expiry>g7z_oauth::unix()+30*86400
            || native_expiry>g7z_oauth::unix()+30*86400{
            return Err(denied());
        }
        Ok(Self{user_id,oauth:OAuthGrant{
            client_id,access_token,refresh_token,token_url,access_expiry,
        },native_token,native_expiry})
    }
}
fn read(app:&AppHandle)->Result<Option<Stored>,String>{
    let value=match vault(app)?.get_password(){
        Ok(x)=>x,
        Err(KeyringError::NoEntry)=>return Ok(None),
        Err(_)=>return Err("G7Z_VAULT_UNAVAILABLE".into()),
    };
    let obj:Value=serde_json::from_str(&value).map_err(|_|denied())?;
    Stored::parse(&obj).map(Some)
}
fn save(app:&AppHandle,record:&Stored)->Result<(),String>{
    vault(app)?.set_password(&record.pack().to_string())
        .map_err(|_|"G7Z_VAULT_WRITE_FAILED".into())
}
fn clear(app:&AppHandle)->Result<(),String>{
    match vault(app)?.delete_credential(){
        Ok(()) | Err(KeyringError::NoEntry)=>Ok(()),
        Err(_)=>Err("G7Z_VAULT_DELETE_FAILED".into())
    }
}
async fn valid_access(app:&AppHandle,record:&mut Stored)->Result<(),String>{
    if record.oauth.access_expiry>g7z_oauth::unix()+45{return Ok(());}
    record.oauth=g7z_oauth::refresh(&record.oauth).await?;
    save(app,record)
}
fn return_link(data:&Value)->Result<Value,String>{
    let obj=data.as_object().ok_or_else(denied)?;
    let code=data.get("userCode").and_then(Value::as_str)
        .ok_or_else(denied)?;
    let link=data.get("linkId").and_then(Value::as_str)
        .ok_or_else(denied)?;
    if obj.len()!=4 || data.get("schema").and_then(Value::as_str)
        !=Some("vyneo.g7z.native_link.v1")
        || data.get("expiresInSeconds").and_then(Value::as_u64)!=Some(300)
        || !hex64(link) || code.len()!=12 || !code.bytes().all(|b|
            b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains(&b)){
        return Err(denied());
    }
    Ok(json!({"state":"LINK_REQUIRED","userCode":code,
              "expiresInSeconds":300}))
}
#[tauri::command]
pub async fn g7z_begin(app:AppHandle,state:State<'_,Bridge>,
                       user_id:String)->Result<Value,String>{
    if !guid(&user_id){return Err(denied());}
    let generation=state.generation.load(Ordering::SeqCst);
    let _gate=state.network.lock().await;
    if state.generation.load(Ordering::SeqCst)!=generation{
        return Err("G7Z_CANCELLED".into());
    }
    let mut record=match read(&app)?{
        Some(saved)=>{
            if !saved.user_id.eq_ignore_ascii_case(&user_id){
                return Err("G7Z_ACCOUNT_MISMATCH".into());
            }
            saved
        },
        None=>Stored{
            user_id:user_id.to_ascii_lowercase(),
            oauth:g7z_oauth::start_oauth().await?,
            native_token:String::new(),native_expiry:0
        }
    };
    if state.generation.load(Ordering::SeqCst)!=generation{
        return Err("G7Z_CANCELLED".into());
    }
    valid_access(&app,&mut record).await?;
    save(&app,&record)?;
    if record.native_expiry>g7z_oauth::unix()+45
        && !record.native_token.is_empty(){
        return Ok(json!({"state":"ALREADY_LINKED"}));
    }
    let verifier=g7z_oauth::random_code()?;
    let nonce=g7z_oauth::random_code()?;
    let reply=g7z_oauth::api_call(&record.oauth,"/native/begin",
        json!({"userId":record.user_id,
               "codeChallenge":g7z_oauth::challenge(&verifier),
               "clientNonce":nonce}),None).await?;
    let output=return_link(&reply)?;
    if state.generation.load(Ordering::SeqCst)!=generation{
        return Err("G7Z_CANCELLED".into());
    }
    let link_id=reply.get("linkId").and_then(Value::as_str)
        .ok_or_else(denied)?.to_owned();
    let mut pending=state.pending.lock().map_err(|_|denied())?;
    *pending=Some(Pending{
        user_id:record.user_id,link_id,verifier,nonce,generation,
    });
    Ok(output)
}
#[tauri::command]
pub async fn g7z_complete(app:AppHandle,state:State<'_,Bridge>,
                          user_id:String)->Result<(),String>{
    if !guid(&user_id){return Err(denied());}
    let _gate=state.network.lock().await;
    let (verifier,nonce,link_id,generation)={
        let pending=state.pending.lock().map_err(|_|denied())?;
        let p=pending.as_ref().ok_or_else(denied)?;
        if !p.user_id.eq_ignore_ascii_case(&user_id)
            || p.generation!=state.generation.load(Ordering::SeqCst){
            return Err(denied());
        }
        (p.verifier.clone(),p.nonce.clone(),p.link_id.clone(),p.generation)
    };
    let mut record=read(&app)?.ok_or_else(denied)?;
    if !record.user_id.eq_ignore_ascii_case(&user_id){
        return Err(denied());
    }
    valid_access(&app,&mut record).await?;
    let reply=g7z_oauth::api_call(&record.oauth,"/native/exchange",
        json!({"userId":record.user_id,"linkId":link_id,
               "clientNonce":nonce,"codeVerifier":verifier}),None).await?;
    if reply.as_object().is_none_or(|v|v.len()!=3)
        || reply.get("schema").and_then(Value::as_str)
            !=Some("vyneo.g7z.native_session.v1")
        || reply.get("expiresInSeconds").and_then(Value::as_u64)!=Some(900){
        return Err(denied());
    }
    let token=reply.get("nativeToken").and_then(Value::as_str)
        .ok_or_else(denied)?;
    if !hex64(token){return Err(denied());}
    if state.generation.load(Ordering::SeqCst)!=generation{
        return Err("G7Z_CANCELLED".into());
    }
    record.native_token=token.into();
    record.native_expiry=g7z_oauth::unix()+895;
    save(&app,&record)?;
    *state.pending.lock().map_err(|_|denied())?=None;
    Ok(())
}

#[tauri::command]
pub async fn g7z_recommendations(
    app:AppHandle,state:State<'_,Bridge>,
    user_id:String,kind:String
)->Result<Value,String>{
    if !guid(&user_id){return Err(denied());}
    let route=match kind.as_str(){
        "rotating"=>"/native/rotating",
        "personal"=>"/native/personal",
        _=>return Err(denied()),
    };
    let generation=state.generation.load(Ordering::SeqCst);
    let _gate=state.network.lock().await;
    if state.generation.load(Ordering::SeqCst)!=generation{
        return Err("G7Z_CANCELLED".into());
    }
    let mut record=read(&app)?.ok_or_else(denied)?;
    if !record.user_id.eq_ignore_ascii_case(&user_id)
        || record.native_token.is_empty() ||
        record.native_expiry<=g7z_oauth::unix(){
        return Err("G7Z_LINK_REQUIRED".into());
    }
    valid_access(&app,&mut record).await?;
    if record.native_expiry<=g7z_oauth::unix()+60{
        let refresh=g7z_oauth::api_call(&record.oauth,"/native/refresh",
            json!({"userId":record.user_id}),
            Some(&record.native_token)).await?;
        if refresh.as_object().map_or(true,|obj|obj.len()!=3)
            || refresh.get("schema").and_then(Value::as_str)
                !=Some("vyneo.g7z.native_session.v1")
            || refresh.get("expiresInSeconds").and_then(Value::as_u64)!=Some(900){
            return Err(denied());
        }
        let new_token=refresh.get("nativeToken").and_then(Value::as_str)
            .ok_or_else(denied)?;
        if !hex64(new_token){return Err(denied());}
        record.native_token=new_token.into();
        record.native_expiry=g7z_oauth::unix()+895;
    }
    if state.generation.load(Ordering::SeqCst)!=generation{
        return Err("G7Z_CANCELLED".into());
    }
    save(&app,&record)?;
    let reply=g7z_oauth::api_call(&record.oauth,route,
        json!({"userId":record.user_id}),
        Some(&record.native_token)).await?;
    if state.generation.load(Ordering::SeqCst)!=generation{
        return Err("G7Z_CANCELLED".into());
    }
    Ok(reply)
}
#[tauri::command]
pub fn g7z_is_linked(app:AppHandle,user_id:String)->bool{
    if !guid(&user_id){return false;}
    match read(&app){
        Ok(Some(entry))=>entry.user_id.eq_ignore_ascii_case(&user_id)
            && hex64(&entry.native_token)
            && entry.native_expiry>g7z_oauth::unix()+60,
        _=>false
    }
}
#[tauri::command]
pub async fn g7z_forget(
    app:AppHandle,state:State<'_,Bridge>
)->Result<(),String>{
    // Invalidate any in-flight OAuth result immediately. Never wait for
    // the browser callback before forgetting the authenticated Jellyfin user.
    state.generation.fetch_add(1,Ordering::SeqCst);
    *state.pending.lock().map_err(|_|denied())?=None;
    let _gate=state.network.lock().await;
    let old=read(&app).ok().flatten();
    clear(&app)?;
    if let Some(entry)=old{
        if !entry.native_token.is_empty() &&
           entry.native_expiry>g7z_oauth::unix() &&
           entry.oauth.access_expiry>g7z_oauth::unix(){
            // Best effort only: local revocation must succeed offline too.
            let _=tokio::time::timeout(std::time::Duration::from_secs(3),
                g7z_oauth::api_call(&entry.oauth,"/native/revoke",
                    json!({"userId":entry.user_id}),
                    Some(&entry.native_token))).await;
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn identity_tokens_and_vault_scope_are_strict(){
        assert!(guid("abc01234567890123456789012345678"));
        assert!(!guid("../steal"));
        assert!(hex64(&"f".repeat(64)));
        assert!(!hex64("f".repeat(63).as_str()));
        assert!(b64(&"a".repeat(43)));
        assert!(!b64("wrong!"));
    }
    #[test]
    fn corrupt_or_overscoped_native_store_is_refused(){
        let valid=json!({
            "userId":"a".repeat(32),
            "clientId":"public-client",
            "accessToken":"oauth:abc123",
            "refreshToken":"oauth:refresh123",
            "tokenEndpoint":"https://patient-brook-0cb9.cloudflareaccess.com/token",
            "accessExpiry":g7z_oauth::unix()+300,
            "nativeToken":"b".repeat(64),
            "nativeExpiry":g7z_oauth::unix()+600
        });
        assert!(Stored::parse(&valid).is_ok());
        let mut wrong=valid.clone();
        wrong["tokenEndpoint"]=json!("https://attacker.example/");
        assert!(Stored::parse(&wrong).is_err());
        wrong=valid.clone();
        wrong["nativeToken"]=json!("../../bad");
        assert!(Stored::parse(&wrong).is_err());
        wrong=valid.clone();
        wrong["scope"]=json!("system_admin");
        assert!(Stored::parse(&wrong).is_err());
    }
}

