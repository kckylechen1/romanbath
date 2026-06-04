//! Shared utilities for xAI tool implementations (image gen, TTS, video gen).
//!
//! Consolidates credential resolution, HTTP client construction, and
//! output-filename sanitization used by all xAI tools.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

/// Maximum allowed size for a single reference image (10 MB).
pub const MAX_REFERENCE_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const XAI_BASE_URL: &str = "https://api.x.ai/v1";
const GROK_AUTH_PATH_ENV: &str = "ZEROCLAW_GROK_AUTH_PATH";
const REFRESH_SKEW_SECS: u64 = 90;

/// Build an [`reqwest::Client`] with a custom timeout suitable for xAI API
/// calls.
pub fn http_client(timeout_secs: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .unwrap_or_default()
}

/// Return whether any xAI credential source is configured.
///
/// This is intentionally synchronous so tool registration can decide whether
/// to expose xAI tools without doing network I/O. Runtime calls use
/// [`resolve_credentials`] so Grok OAuth tokens can be refreshed as needed.
pub fn has_configured_credentials(fallback_api_key: Option<&str>) -> bool {
    if let Ok(token) = std::env::var("XAI_OAUTH_TOKEN")
        && !token.trim().is_empty()
    {
        return true;
    }

    if let Ok(api_key) = std::env::var("XAI_API_KEY")
        && !api_key.trim().is_empty()
    {
        return true;
    }

    if grok_auth_path().is_some_and(|p| p.exists()) {
        return true;
    }

    if let Some(key) = fallback_api_key
        && !key.trim().is_empty()
    {
        return true;
    }

    false
}

/// Resolve xAI credentials from environment variables, Grok CLI auth, or a
/// config-provided fallback.
///
/// Prefers `XAI_OAUTH_TOKEN`, then `XAI_API_KEY`, then Grok CLI auth from
/// `~/.grok/auth.json` (with refresh), then the optional `fallback_api_key`
/// (typically read from zeroclaw config). Returns `(auth_token, base_url)`.
pub async fn resolve_credentials(
    fallback_api_key: Option<&str>,
) -> Result<(String, String), String> {
    if let Ok(token) = std::env::var("XAI_OAUTH_TOKEN")
        && !token.trim().is_empty()
    {
        return Ok((token, XAI_BASE_URL.to_string()));
    }

    if let Ok(api_key) = std::env::var("XAI_API_KEY")
        && !api_key.trim().is_empty()
    {
        return Ok((api_key, XAI_BASE_URL.to_string()));
    }

    if let Some(token) = resolve_grok_auth_token().await? {
        return Ok((token, XAI_BASE_URL.to_string()));
    }

    if let Some(key) = fallback_api_key
        && !key.trim().is_empty()
    {
        return Ok((key.trim().to_string(), XAI_BASE_URL.to_string()));
    }

    Err("No xAI credentials found. Run `grok auth`, set XAI_OAUTH_TOKEN/XAI_API_KEY, or configure an xAI API key.".to_string())
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct GrokAuthEntry {
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_at: Option<DateTime<Utc>>,
    #[serde(default)]
    oidc_client_id: Option<String>,
    #[serde(default)]
    oidc_issuer: Option<String>,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}

type GrokAuthFile = BTreeMap<String, GrokAuthEntry>;

async fn resolve_grok_auth_token() -> Result<Option<String>, String> {
    let Some(path) = grok_auth_path() else {
        return Ok(None);
    };
    if !path.exists() {
        return Ok(None);
    }

    let raw = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read Grok auth file {}: {e}", path.display()))?;
    let mut auth: GrokAuthFile = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse Grok auth file {}: {e}", path.display()))?;

    let Some(profile_key) = select_grok_auth_profile(&auth) else {
        return Ok(None);
    };

    let profile = auth
        .get(&profile_key)
        .expect("selected Grok auth profile must exist");
    if let Some(token) = valid_access_token(profile) {
        return Ok(Some(token));
    }

    let Some(refresh_token) = profile
        .refresh_token
        .clone()
        .filter(|t| !t.trim().is_empty())
    else {
        return Ok(profile.key.clone().filter(|t| !t.trim().is_empty()));
    };
    let client_id = profile
        .oidc_client_id
        .clone()
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| zeroclaw_providers::auth::xai_oauth::XAI_PUBLIC_CLIENT_ID.to_string());

    let client = http_client(60);
    let endpoints = zeroclaw_providers::auth::xai_oauth::discover_endpoints(&client).await;
    let refreshed = zeroclaw_providers::auth::xai_oauth::refresh_token(
        &client,
        &client_id,
        &refresh_token,
        &endpoints.token_url,
    )
    .await
    .map_err(|e| format!("Failed to refresh Grok auth token: {e}"))?;

    if let Some(profile) = auth.get_mut(&profile_key) {
        profile.key = Some(refreshed.access_token.clone());
        if let Some(refresh_token) = refreshed.refresh_token.clone() {
            profile.refresh_token = Some(refresh_token);
        }
        profile.expires_at = refreshed.expires_at;
    }

    let updated = serde_json::to_string_pretty(&auth)
        .map_err(|e| format!("Failed to serialize refreshed Grok auth file: {e}"))?;
    tokio::fs::write(&path, updated)
        .await
        .map_err(|e| format!("Failed to update Grok auth file {}: {e}", path.display()))?;

    Ok(Some(refreshed.access_token))
}

fn select_grok_auth_profile(auth: &GrokAuthFile) -> Option<String> {
    auth.iter().find_map(|(key, profile)| {
        let has_token = profile
            .key
            .as_deref()
            .is_some_and(|token| !token.trim().is_empty());
        let has_refresh = profile
            .refresh_token
            .as_deref()
            .is_some_and(|token| !token.trim().is_empty());
        let issuer_is_xai = profile
            .oidc_issuer
            .as_deref()
            .is_none_or(|issuer| issuer == "https://auth.x.ai" || issuer.ends_with(".x.ai"));
        ((has_token || has_refresh) && issuer_is_xai).then(|| key.clone())
    })
}

fn valid_access_token(profile: &GrokAuthEntry) -> Option<String> {
    let token = profile
        .key
        .as_deref()
        .filter(|token| !token.trim().is_empty())?;
    if is_expiring(profile.expires_at) {
        return None;
    }
    Some(token.to_string())
}

fn is_expiring(expires_at: Option<DateTime<Utc>>) -> bool {
    let Some(expires_at) = expires_at else {
        return false;
    };
    let skew =
        chrono::Duration::from_std(Duration::from_secs(REFRESH_SKEW_SECS)).unwrap_or_default();
    expires_at <= Utc::now() + skew
}

fn grok_auth_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var(GROK_AUTH_PATH_ENV)
        && !path.trim().is_empty()
    {
        return Some(PathBuf::from(path));
    }
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".grok").join("auth.json"))
}

/// Sanitise a user-supplied filename prefix so it cannot escape the intended
/// output directory.
///
/// Strips path components (directory traversal, `..`, `/`, `\`) by keeping
/// only the final filename component. Falls back to `default_name` when the
/// result would be empty.
pub fn sanitize_filename(raw: &str, default_name: &str) -> String {
    PathBuf::from(raw)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_name.to_string())
}

pub fn image_mime_type(bytes: &[u8]) -> &'static str {
    infer::get(bytes)
        .map(|kind| kind.mime_type())
        .filter(|mime| mime.starts_with("image/"))
        .unwrap_or("image/png")
}

pub fn image_extension(bytes: &[u8]) -> &'static str {
    match image_mime_type(bytes) {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "img",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct EnvGuard {
        grok_path: Option<std::ffi::OsString>,
        oauth_token: Option<std::ffi::OsString>,
        api_key: Option<std::ffi::OsString>,
    }

    impl EnvGuard {
        fn set_grok_path(path: &std::path::Path) -> Self {
            let guard = Self {
                grok_path: std::env::var_os(GROK_AUTH_PATH_ENV),
                oauth_token: std::env::var_os("XAI_OAUTH_TOKEN"),
                api_key: std::env::var_os("XAI_API_KEY"),
            };
            unsafe {
                std::env::set_var(GROK_AUTH_PATH_ENV, path);
                std::env::remove_var("XAI_OAUTH_TOKEN");
                std::env::remove_var("XAI_API_KEY");
            }
            guard
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            unsafe {
                match &self.grok_path {
                    Some(value) => std::env::set_var(GROK_AUTH_PATH_ENV, value),
                    None => std::env::remove_var(GROK_AUTH_PATH_ENV),
                }
                match &self.oauth_token {
                    Some(value) => std::env::set_var("XAI_OAUTH_TOKEN", value),
                    None => std::env::remove_var("XAI_OAUTH_TOKEN"),
                }
                match &self.api_key {
                    Some(value) => std::env::set_var("XAI_API_KEY", value),
                    None => std::env::remove_var("XAI_API_KEY"),
                }
            }
        }
    }

    fn write_grok_auth(path: &std::path::Path, token: &str, expires_at: &str) {
        let auth = serde_json::json!({
            "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828": {
                "auth_mode": "oidc",
                "key": token,
                "refresh_token": "refresh-token",
                "expires_at": expires_at,
                "oidc_client_id": zeroclaw_providers::auth::xai_oauth::XAI_PUBLIC_CLIENT_ID,
                "oidc_issuer": "https://auth.x.ai"
            }
        });
        std::fs::write(path, serde_json::to_string_pretty(&auth).unwrap()).unwrap();
    }

    #[test]
    fn has_configured_credentials_detects_grok_auth_file() {
        let _lock = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let auth_path = tmp.path().join("auth.json");
        write_grok_auth(&auth_path, "grok-token", "2099-01-01T00:00:00Z");
        let _env = EnvGuard::set_grok_path(&auth_path);

        assert!(has_configured_credentials(None));
    }

    #[tokio::test]
    async fn resolve_credentials_prefers_valid_grok_auth_over_fallback() {
        let _lock = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let auth_path = tmp.path().join("auth.json");
        write_grok_auth(&auth_path, "grok-token", "2099-01-01T00:00:00Z");
        let _env = EnvGuard::set_grok_path(&auth_path);

        let (token, base_url) = resolve_credentials(Some("fallback-token")).await.unwrap();

        assert_eq!(token, "grok-token");
        assert_eq!(base_url, XAI_BASE_URL);
    }
}
