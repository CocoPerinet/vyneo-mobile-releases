// Ephemeral PR-only minisign QA. Never bundled into Vynéo or distributed.
use minisign_verify::{PublicKey, Signature};
use std::{env, error::Error, fs::File, io::Read, path::Path};

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args_os().collect();
    if args.len() != 4 {
        return Err("USAGE: verifier <ephemeral-public-key> <signature> <artifact>".into());
    }
    let public = PublicKey::from_file(Path::new(&args[1]))?;
    let signature = Signature::from_file(Path::new(&args[2]))?;
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
