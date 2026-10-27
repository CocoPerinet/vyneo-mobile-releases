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
    if args.len() != 5 {
        return Err("USAGE: verifier <public-key> <signature> <artifact> <expected-version>".into());
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
    let expected=args[4].to_str().ok_or("INVALID_EXPECTED_VERSION")?;
    verify_signed_version(signature.trusted_comment(), expected)?;
    println!("VYNEO_MINISIGN_SIGNATURE_AND_VERSION_BOUND_PASS");
    Ok(())
}

// Run only AFTER authenticating the complete Minisign signature, including
// its trusted comment. Tauri updater 2.14 rejects signatures without a
// cryptographically bound version when requireSignedVersion=true.
fn verify_signed_version(comment: &str, expected: &str) -> Result<(), Box<dyn Error>> {
    let valid=expected.split('.').count()==3 &&
        expected.split('.').all(|part| !part.is_empty() &&
            part.len()<=15 && part.bytes().all(|b| b.is_ascii_digit()) &&
            (part.len()==1 || !part.starts_with('0')));
    if !valid { return Err("INVALID_EXPECTED_VERSION".into()); }
    let mut values=comment.split('\t').filter_map(|field| field.strip_prefix("version:"));
    if values.next()!=Some(expected) || values.next().is_some() {
        return Err("MINISIGN_SIGNED_VERSION_MISSING_OR_MISMATCH".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::verify_signed_version;
    #[test]
    fn require_exact_cryptographically_trusted_version() {
        let ok="timestamp:123\tfile:installer.exe\tversion:0.2.5";
        assert!(verify_signed_version(ok,"0.2.5").is_ok());
        for comment in [
            "timestamp:123\tfile:installer.exe",
            "timestamp:123\tfile:installer.exe\tversion:0.2.4",
            "timestamp:123\tfile:installer.exe\tversion:0.2.5-rc.1",
            "timestamp:123\tfile:version:0.2.5",
            "version:0.2.5\tversion:0.2.5"
        ] {
            assert!(verify_signed_version(comment,"0.2.5").is_err(), "{comment}");
        }
        for invalid in ["", "1", "v0.2.5", "0.2.05", "0.2.5-beta", "0.2.5.1"] {
            assert!(verify_signed_version(ok,invalid).is_err(), "{invalid}");
        }
    }
}
