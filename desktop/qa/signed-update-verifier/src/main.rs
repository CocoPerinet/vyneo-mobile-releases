// Ephemeral PR-only minisign QA. Never bundled into Vynéo or distributed.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use std::{env, error::Error, fs::{self, File}, io::Read, path::Path};

fn tauri_minisign_envelope(path: &Path) -> Result<String, Box<dyn Error>> {
    // Tauri stores signatures and pubkeys as base64 of the *full* Minisign
    // text envelope. Reject binary, truncated or unbounded input.
    let encoded=fs::read_to_string(path)?;
    if encoded.len()>16384 { return Err("OVERSIZED_SIGNING_ENVELOPE".into()); }
    let decoded=STANDARD.decode(encoded.trim())?;
    let content=String::from_utf8(decoded)?;
    if !content.starts_with("untrusted comment: ") {
        return Err("MALFORMED_SIGNING_ENVELOPE".into());
    }
    Ok(content)
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args_os().collect();
    if args.len() != 4 {
        return Err("USAGE: verifier <ephemeral-public-key> <signature> <artifact>".into());
    }
    let public_envelope=tauri_minisign_envelope(Path::new(&args[1]))?;
    let signature_envelope=tauri_minisign_envelope(Path::new(&args[2]))?;
    let public=PublicKey::decode(&public_envelope)?;
    let signature=Signature::decode(&signature_envelope)?;
    let mut verifier = public.verify_stream(&signature)?;
    let mut artifact = File::open(&args[3])?;
    let mut chunk = [0u8; 65536];
    loop {
        let n = artifact.read(&mut chunk)?;
        if n == 0 { break; }
        verifier.update(&chunk[..n]);
    }
    verifier.finalize()?;
    println!("VYNEO_EPHEMERAL_MINISIGN_CRYPTOGRAPHIC_VERIFICATION_PASS");
    Ok(())
}
