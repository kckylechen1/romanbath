//! Shared utilities for xAI tool implementations (image gen, TTS, video gen).
//!
//! Consolidates credential resolution, HTTP client construction, and
//! output-filename sanitization used by all xAI tools.

use std::path::PathBuf;

/// Maximum allowed size for a single reference image (10 MB).
pub const MAX_REFERENCE_IMAGE_BYTES: usize = 10 * 1024 * 1024;

/// Build an [`reqwest::Client`] with a custom timeout suitable for xAI API
/// calls.
pub fn http_client(timeout_secs: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .unwrap_or_default()
}

/// Resolve xAI credentials from environment variables or a config-provided fallback.
///
/// Prefers `XAI_OAUTH_TOKEN` (OAuth bearer), then `XAI_API_KEY`, then the
/// optional `fallback_api_key` (typically read from zeroclaw config).
/// Returns `(auth_token, base_url)`.
pub fn resolve_credentials(fallback_api_key: Option<&str>) -> Result<(String, String), String> {
    // Try OAuth token first
    if let Ok(token) = std::env::var("XAI_OAUTH_TOKEN")
        && !token.trim().is_empty()
    {
        return Ok((token, "https://api.x.ai/v1".to_string()));
    }

    // Fallback to API key env var
    if let Ok(api_key) = std::env::var("XAI_API_KEY")
        && !api_key.trim().is_empty()
    {
        return Ok((api_key, "https://api.x.ai/v1".to_string()));
    }

    // Try config-provided fallback key
    if let Some(key) = fallback_api_key
        && !key.trim().is_empty()
    {
        return Ok((key.trim().to_string(), "https://api.x.ai/v1".to_string()));
    }

    Err("XAI_OAUTH_TOKEN or XAI_API_KEY environment variable not set, and no fallback API key provided".to_string())
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
