use std::path::PathBuf;
use zeroclaw_config::secrets::SecretStore;

fn main() -> anyhow::Result<()> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("HOME is not set"))?;
    let config_dir = home.join(".zeroclaw");
    
    let profiles_path = config_dir.join("auth-profiles.json");
    let profiles: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&profiles_path)?
    )?;
    
    let profile = &profiles["profiles"]["xai:default"];
    let enc_access = profile["access_token"].as_str().unwrap();
    
    println!("Encrypted token: {}...", &enc_access[..30]);
    
    let secret_store = SecretStore::new(&config_dir, true);
    let (token, _migrated) = secret_store.decrypt_and_migrate(enc_access)?;
    
    println!("Decrypted token: {}...", &token[..20]);
    
    let client = reqwest::blocking::Client::new();
    
    // Test image gen
    let resp = client.post("https://api.x.ai/v1/images/generations")
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({
            "model": "grok-imagine-image",
            "prompt": "A serene Roman bath house interior with warm amber lighting, marble columns, and steam rising from the water",
            "n": 1,
            "size": "1024x1024"
        }))
        .send()?;
    
    println!("\n=== Image Gen ===");
    println!("Status: {}", resp.status());
    let body = resp.text()?;
    println!("Response: {}", &body[..300.min(body.len())]);
    
    // Test TTS
    let resp = client.post("https://api.x.ai/v1/audio/speech")
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({
            "model": "grok-tts-1",
            "input": "Welcome to the Roman Bath. The water is warm and inviting.",
            "voice": "nova",
            "speed": 1.0
        }))
        .send()?;
    
    println!("\n=== TTS ===");
    println!("Status: {}", resp.status());
    
    Ok(())
}
