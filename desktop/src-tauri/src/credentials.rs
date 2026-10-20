// Credentials never enter logs, disk config, browser storage or release assets.
// Windows uses Credential Manager; macOS uses the system Keychain.
use keyring::{Entry, Error};
use serde_json::{json, Value};

const SERVICE: &str = "fr.visyren.vyneo.desktop.jellyfin";
const ACCOUNT: &str = "active-user";

fn token_valid(token: &str) -> bool {
    (12..=2048).contains(&token.len())
        && token.bytes().all(|b| b.is_ascii_alphanumeric()
            || b == b'.' || b == b'_' || b == b'-')
}
fn id_valid(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())
}
fn name_valid(name: &str) -> bool {
    !name.trim().is_empty()
        && name.len() <= 96
        && !name.chars().any(|c| c.is_control())
}
fn vault() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|_| "VAULT_UNAVAILABLE".to_string())
}
#[tauri::command]
pub fn save_saved_session(
    user_id: String, username: String, access_token: String,
) -> Result<(), String> {
    if !id_valid(&user_id) || !name_valid(&username) ||
        !token_valid(&access_token) {
        return Err("VAULT_INVALID_SESSION".to_string());
    }
    // The token is validated again by Jellyfin /Users/Me on every launch.
    let record=json!({"userId":user_id,"username":username,
        "accessToken":access_token});
    vault()?.set_password(&record.to_string())
        .map_err(|_| "VAULT_SAVE_FAILED".to_string())
}
#[tauri::command]
pub fn read_saved_session() -> Result<Option<Value>, String> {
    let stored=match vault()?.get_password() {
        Ok(value)=>value,
        Err(Error::NoEntry)=>return Ok(None),
        Err(_)=>return Err("VAULT_READ_FAILED".to_string())
    };
    let record:Value=serde_json::from_str(&stored)
        .map_err(|_| "VAULT_INVALID_SESSION".to_string())?;
    if !record.get("userId").and_then(Value::as_str).is_some_and(id_valid)
        || !record.get("username").and_then(Value::as_str).is_some_and(name_valid)
        || !record.get("accessToken").and_then(Value::as_str).is_some_and(token_valid)
    {
        return Err("VAULT_INVALID_SESSION".to_string());
    }
    Ok(Some(record))
}
#[tauri::command]
pub fn forget_saved_session() -> Result<(), String> {
    match vault()?.delete_credential() {
        Ok(()) | Err(Error::NoEntry)=>Ok(()),
        Err(_)=>Err("VAULT_DELETE_FAILED".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_malformed_credentials() {
        assert!(id_valid("0123456789abcdef0123456789abcdef"));
        assert!(!id_valid("../../../etc/passwd"));
        assert!(token_valid("ThisIsAValidSecret12345"));
        assert!(!token_valid("bad\nTokenWithSecrets"));
        assert!(name_valid("Alice"));
        assert!(!name_valid("Alice\nAdmin"));
    }
}
