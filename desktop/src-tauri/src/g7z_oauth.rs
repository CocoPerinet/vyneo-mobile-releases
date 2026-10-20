//! Native-only Managed OAuth code+PKCE and bounded HTTPS transport.
//! No bearer, code verifier, refresh token, or JWT is ever returned to WebView.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD,Engine};
use reqwest::{Client,Response,Url};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::time::{Duration,SystemTime,UNIX_EPOCH};
use tokio::io::{AsyncReadExt,AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::timeout;

pub const ORIGIN:&str="https://vyneo-preview.visyren.fr";
const TEAM:&str="patient-brook-0cb9.cloudflareaccess.com";
const MAX_JSON:usize=65536;

#[derive(Clone)]
pub struct OAuthGrant{
    pub client_id:String,
    pub access_token:String,
    pub refresh_token:String,
    pub token_url:String,
    pub access_expiry:u64,
}
fn failed()->String{"G7Z_OAUTH_DENIED".into()}
pub fn unix()->u64{
    SystemTime::now().duration_since(UNIX_EPOCH)
        .unwrap_or_default().as_secs()
}
pub fn random_code()->Result<String,String>{
    let mut bytes=[0u8;32];
    getrandom::fill(&mut bytes).map_err(|_|failed())?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
pub fn challenge(secret:&str)->String{
    URL_SAFE_NO_PAD.encode(Sha256::digest(secret.as_bytes()))
}
pub fn endpoint(raw:&str)->Result<Url,String>{
    let url=Url::parse(raw).map_err(|_|failed())?;
    if url.scheme()!="https:" || url.port_or_known_default()!=Some(443) ||
        url.host_str()!=Some(TEAM) && url.host_str()!=Some("vyneo-preview.visyren.fr") ||
        !url.username().is_empty() || url.password().is_some() ||
        url.fragment().is_some(){
        return Err(failed());
    }
    Ok(url)
}
pub fn http()->Result<Client,String>{
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(8))
        .build().map_err(|_|failed())
}
pub async fn bounded(response:Response)->Result<Value,String>{
    if !response.status().is_success(){return Err(failed());}
    if let Some(len)=response.content_length(){
        if len>MAX_JSON as u64{return Err(failed());}
    }
    let mut buf=Vec::new();
    let mut reply=response;
    while let Some(piece)=reply.chunk().await.map_err(|_|failed())?{
        if piece.len()>MAX_JSON.saturating_sub(buf.len()){
            return Err(failed());
        }
        buf.extend_from_slice(&piece);
    }
    serde_json::from_slice(&buf).map_err(|_|failed())
}
fn text<'a>(doc:&'a Value,key:&str,max:usize)->Result<&'a str,String>{
    let value=doc.get(key).and_then(Value::as_str).ok_or_else(failed)?;
    if value.is_empty() || value.len()>max ||
        value.bytes().any(|b|b<33 || b>126){
        return Err(failed());
    }
    Ok(value)
}
fn new_grant(doc:&Value,client_id:String,token_url:String,
             previous_refresh:&str)->Result<OAuthGrant,String>{
    let access=text(doc,"access_token",8192)?.to_string();
    let token_type=text(doc,"token_type",32)?;
    if !token_type.eq_ignore_ascii_case("Bearer"){return Err(failed());}
    let expiry=doc.get("expires_in").and_then(Value::as_u64)
        .ok_or_else(failed)?;
    if !(30..=172800).contains(&expiry){return Err(failed());}
    let refresh=doc.get("refresh_token").and_then(Value::as_str)
        .unwrap_or(previous_refresh);
    if !refresh.is_empty() && (refresh.len()>8192 ||
        refresh.bytes().any(|b|b<33 || b>126)){return Err(failed());}
    Ok(OAuthGrant{
        client_id,access_token:access,refresh_token:refresh.to_string(),
        token_url,access_expiry:unix().saturating_add(expiry.saturating_sub(25))
    })
}
async fn callback(listener:TcpListener,expected:&str)->Result<String,String>{
    // The callback is restricted to the already-bound loopback listener.
    let deadline=tokio::time::Instant::now()+Duration::from_secs(150);
    loop{
        let remains=deadline.saturating_duration_since(tokio::time::Instant::now());
        if remains.is_zero(){return Err(failed());}
        let (mut stream,peer)=timeout(remains,listener.accept())
            .await.map_err(|_|failed())?.map_err(|_|failed())?;
        if !peer.ip().is_loopback(){continue;}
        let mut input=[0u8;4096];
        let n=timeout(Duration::from_secs(4),stream.read(&mut input))
            .await.map_err(|_|failed())?.map_err(|_|failed())?;
        let req=std::str::from_utf8(&input[..n]).map_err(|_|failed())?;
        let line=req.split("\r\n").next().unwrap_or("");
        let mut parts=line.split(' ');
        let method=parts.next().unwrap_or("");
        let target=parts.next().unwrap_or("");
        let version=parts.next().unwrap_or("");
        let mut verified=None;
        if method=="GET" && (version=="HTTP/1.1" || version=="HTTP/1.0")
            && parts.next().is_none() && target.starts_with("/callback?"){
            if let Ok(url)=Url::parse(&format!("http://127.0.0.1{target}")){
                let pairs:Vec<(String,String)>=url.query_pairs()
                    .map(|(k,v)|(k.into_owned(),v.into_owned())).collect();
                let code:Vec<_>=pairs.iter().filter(|(k,_)|k=="code").collect();
                let state:Vec<_>=pairs.iter().filter(|(k,_)|k=="state").collect();
                if pairs.len()==2 && code.len()==1 && state.len()==1 &&
                    state[0].1==expected && (8..=2048).contains(&code[0].1.len())
                    && code[0].1.bytes().all(|b|b.is_ascii_alphanumeric()
                        || matches!(b,b'_'|b'-'|b'.'|b'~')){
                    verified=Some(code[0].1.clone());
                }
            }
        }
        let (status,body)=if verified.is_some(){
            ("200 OK","Vynéo : connexion autorisée. Revenez à l'application.")
        }else{("400 Bad Request","Requête de connexion refusée.")};
        let answer=format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\n\
             Content-Security-Policy: default-src 'none'\r\nCache-Control: no-store\r\n\
             X-Content-Type-Options: nosniff\r\nConnection: close\r\n\
             Content-Length: {}\r\n\r\n{body}",body.len());
        let _=stream.write_all(answer.as_bytes()).await;
        if let Some(code)=verified{return Ok(code);}
    }
}
pub async fn start_oauth()->Result<OAuthGrant,String>{
    let client=http()?;
    let metadata=bounded(client.get(format!(
        "{ORIGIN}/.well-known/oauth-authorization-server"
    )).send().await.map_err(|_|failed())?).await?;
    let authorization=endpoint(text(&metadata,"authorization_endpoint",2048)?)?;
    let registration=endpoint(text(&metadata,"registration_endpoint",2048)?)?;
    let token_url=endpoint(text(&metadata,"token_endpoint",2048)?)?;
    let listener=TcpListener::bind(("127.0.0.1",0))
        .await.map_err(|_|failed())?;
    let port=listener.local_addr().map_err(|_|failed())?.port();
    let redirect=format!("http://127.0.0.1:{port}/callback");
    let registered=bounded(client.post(registration)
        .json(&json!({
            "client_name":"Vynéo Desktop",
            "redirect_uris":[redirect],
            "grant_types":["authorization_code","refresh_token"],
            "response_types":["code"],
            "token_endpoint_auth_method":"none"
        })).send().await.map_err(|_|failed())?).await?;
    let client_id=text(&registered,"client_id",512)?.to_string();
    let verifier=random_code()?;
    let state=random_code()?;
    let mut url=authorization;
    url.query_pairs_mut()
        .append_pair("response_type","code")
        .append_pair("client_id",&client_id)
        .append_pair("redirect_uri",&redirect)
        .append_pair("code_challenge",&challenge(&verifier))
        .append_pair("code_challenge_method","S256")
        .append_pair("resource",ORIGIN)
        .append_pair("state",&state);
    webbrowser::open(url.as_str()).map_err(|_|failed())?;
    let authorization_code=callback(listener,&state).await?;
    let response=bounded(client.post(token_url.clone()).form(&[
        ("grant_type","authorization_code"),
        ("code",authorization_code.as_str()),
        ("client_id",client_id.as_str()),
        ("code_verifier",verifier.as_str()),
        ("redirect_uri",redirect.as_str()),
        ("resource",ORIGIN)
    ]).send().await.map_err(|_|failed())?).await?;
    new_grant(&response,client_id,token_url.to_string(),"")
}
pub async fn refresh(grant:&OAuthGrant)->Result<OAuthGrant,String>{
    if grant.refresh_token.is_empty(){return Err("G7Z_REAUTH_REQUIRED".into());}
    let client=http()?;
    let url=endpoint(&grant.token_url)?;
    let response=client.post(url).form(&[
        ("grant_type","refresh_token"),
        ("refresh_token",grant.refresh_token.as_str()),
        ("client_id",grant.client_id.as_str()),
        ("resource",ORIGIN)
    ]).send().await.map_err(|_|failed())?;
    if matches!(response.status().as_u16(),400|401|403){
        return Err("G7Z_REAUTH_REQUIRED".into());
    }
    let data=bounded(response).await?;
    new_grant(&data,grant.client_id.clone(),grant.token_url.clone(),
              &grant.refresh_token)
}
pub async fn api_call(grant:&OAuthGrant,path:&str,
                      body:Value,native_token:Option<&str>)->Result<Value,String>{
    if !matches!(path,"/native/begin"|"/native/exchange"|"/native/refresh"|
        "/native/rotating"|"/native/personal"|"/native/revoke"){
        return Err(failed());
    }
    if grant.access_expiry<=unix(){return Err("G7Z_REAUTH_REQUIRED".into());}
    let mut request=http()?.post(format!("{ORIGIN}{path}"))
        .bearer_auth(&grant.access_token)
        .header("X-Vyneo-Native-Client","1")
        .json(&body);
    if let Some(token)=native_token{
        if token.len()!=64 || !token.bytes().all(|b|b.is_ascii_hexdigit()){
            return Err(failed());
        }
        request=request.header("X-Vyneo-Native-Session",token);
    }
    bounded(request.send().await.map_err(|_|failed())?).await
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn challenge_and_urls_are_pinned(){
        assert_eq!(challenge("a".repeat(43).as_str()).len(),43);
        assert!(endpoint("https://patient-brook-0cb9.cloudflareaccess.com/callback").is_ok());
        assert!(endpoint("https://user@vyneo-preview.visyren.fr/").is_err());
        assert!(endpoint("http://vyneo-preview.visyren.fr/").is_err());
        assert!(endpoint("https://attacker.example/").is_err());
        assert!(endpoint("https://vyneo-preview.visyren.fr:444/").is_err());
    }
    #[test]
    fn oauth_grants_reject_bad_token_type_and_fake_expiration(){
        let valid=json!({"access_token":"oauth:123456abcdef","token_type":"Bearer",
                         "expires_in":300});
        assert!(new_grant(&valid,"client".into(),
            "https://patient-brook-0cb9.cloudflareaccess.com/token".into(),"").is_ok());
        assert!(new_grant(&json!({"access_token":"leaked",
            "token_type":"Basic","expires_in":300}),"client".into(),
            "https://patient-brook-0cb9.cloudflareaccess.com/token".into(),"").is_err());
        assert!(new_grant(&json!({"access_token":"valid",
            "token_type":"Bearer","expires_in":1}),"client".into(),
            "https://patient-brook-0cb9.cloudflareaccess.com/token".into(),"").is_err());
    }
}
