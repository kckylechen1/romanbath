//! xAI/Grok OAuth2 authentication flow.
//!
//! Supports:
//! - Authorization code flow with PKCE (browser login) — public client, no secret needed
//! - Device code flow for headless environments
//! - Token refresh for long-lived sessions
//! - OIDC discovery for endpoint resolution
//!
//! Based on xAI's OAuth 2.0 implementation for Grok access.

use crate::auth::oauth_common::{parse_query_params, url_decode, url_encode};
use crate::auth::profiles::TokenSet;
use anyhow::{Context, Result};
use chrono::Utc;
use reqwest::Client;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

// ── Public client constants ─────────────────────────────────────────────
// These are the same public OAuth values used by xAI's Grok CLI/web app.
// PKCE provides security without requiring a client secret.

/// Public client ID for xAI PKCE flow (no client secret needed).
pub const XAI_PUBLIC_CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";

/// OIDC discovery endpoint for dynamic endpoint resolution.
pub const XAI_OIDC_DISCOVERY_URL: &str = "https://auth.x.ai/.well-known/openid-configuration";

/// Extended scopes for full Grok API access.
pub const XAI_OAUTH_SCOPES: &str = "openid profile email offline_access grok-cli:access api:access";

// ── Hardcoded fallback endpoints ────────────────────────────────────────
// Used when OIDC discovery fails (offline / air-gapped environments).

pub const XAI_OAUTH_AUTHORIZE_URL: &str = "https://accounts.x.ai/oauth/authorize";
pub const XAI_OAUTH_TOKEN_URL: &str = "https://accounts.x.ai/oauth/token";
pub const XAI_OAUTH_DEVICE_CODE_URL: &str = "https://accounts.x.ai/oauth/device_code";
pub const XAI_OAUTH_REDIRECT_URI: &str = "http://127.0.0.1:56121/callback";

// ── OIDC Discovery ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
struct OidcConfig {
    authorization_endpoint: String,
    token_endpoint: String,
    #[serde(default)]
    device_authorization_endpoint: Option<String>,
}

/// Discovered + validated OAuth endpoints (with hardcoded fallbacks).
#[derive(Debug, Clone)]
pub struct XaiEndpoints {
    pub authorize_url: String,
    pub token_url: String,
    pub device_code_url: String,
}

impl Default for XaiEndpoints {
    fn default() -> Self {
        Self {
            authorize_url: XAI_OAUTH_AUTHORIZE_URL.to_string(),
            token_url: XAI_OAUTH_TOKEN_URL.to_string(),
            device_code_url: XAI_OAUTH_DEVICE_CODE_URL.to_string(),
        }
    }
}

/// Validate that an endpoint URL belongs to the x.ai domain to prevent
/// credential leakage via env-var tampering or compromised discovery.
fn validate_xai_endpoint(url: &str) -> Result<()> {
    let parsed = url::Url::parse(url).context("Invalid endpoint URL")?;
    let host = parsed.host_str().context("Endpoint URL missing host")?;
    if host == "x.ai" || host.ends_with(".x.ai") {
        Ok(())
    } else {
        anyhow::bail!("Endpoint {} is not on x.ai domain", url)
    }
}

/// Fetch OIDC discovery document and return validated endpoints.
/// Falls back to hardcoded constants on any failure.
pub async fn discover_endpoints(client: &Client) -> XaiEndpoints {
    match discover_endpoints_inner(client).await {
        Ok(endpoints) => endpoints,
        Err(e) => {
            eprintln!(
                "xAI OIDC discovery failed ({}), using hardcoded endpoints",
                e
            );
            XaiEndpoints::default()
        }
    }
}

async fn discover_endpoints_inner(client: &Client) -> Result<XaiEndpoints> {
    let resp = client
        .get(XAI_OIDC_DISCOVERY_URL)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .context("Failed to fetch xAI OIDC discovery")?;

    if !resp.status().is_success() {
        anyhow::bail!("OIDC discovery returned {}", resp.status());
    }

    let oidc: OidcConfig = resp
        .json()
        .await
        .context("Failed to parse OIDC discovery document")?;

    validate_xai_endpoint(&oidc.authorization_endpoint)?;
    validate_xai_endpoint(&oidc.token_endpoint)?;

    let device_code_url = oidc
        .device_authorization_endpoint
        .as_deref()
        .map(|u| {
            validate_xai_endpoint(u).ok();
            u.to_string()
        })
        .unwrap_or_else(|| XAI_OAUTH_DEVICE_CODE_URL.to_string());

    Ok(XaiEndpoints {
        authorize_url: oidc.authorization_endpoint,
        token_url: oidc.token_endpoint,
        device_code_url,
    })
}

// ── Data types ──────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct DeviceCodeStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    token_type: Option<String>,
    #[serde(default)]
    scope: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_url: String,
    #[serde(default)]
    verification_uri_complete: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    interval: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct OAuthErrorResponse {
    error: String,
    #[serde(default)]
    error_description: Option<String>,
}

// ── URL building ────────────────────────────────────────────────────────

pub fn build_authorize_url(
    client_id: &str,
    pkce: &crate::auth::oauth_common::PkceState,
    authorize_endpoint: &str,
) -> Result<String> {
    let mut params = BTreeMap::new();
    params.insert("response_type", "code");
    params.insert("client_id", client_id);
    params.insert("redirect_uri", XAI_OAUTH_REDIRECT_URI);
    params.insert("scope", XAI_OAUTH_SCOPES);
    params.insert("code_challenge", pkce.code_challenge.as_str());
    params.insert("code_challenge_method", "S256");
    params.insert("state", pkce.state.as_str());

    let mut encoded: Vec<String> = Vec::with_capacity(params.len());
    for (k, v) in params {
        encoded.push(format!("{}={}", url_encode(k), url_encode(v)));
    }

    Ok(format!("{}?{}", authorize_endpoint, encoded.join("&")))
}

// ── Token exchange (public client — no client_secret) ───────────────────

pub async fn exchange_code_for_tokens(
    client: &Client,
    client_id: &str,
    code: &str,
    pkce: &crate::auth::oauth_common::PkceState,
    token_endpoint: &str,
) -> Result<TokenSet> {
    let form = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", XAI_OAUTH_REDIRECT_URI),
        ("client_id", client_id),
        ("code_verifier", &pkce.code_verifier),
    ];

    let response = client
        .post(token_endpoint)
        .form(&form)
        .send()
        .await
        .context("Failed to send xAI token exchange request")?;

    let status = response.status();
    let body = response
        .text()
        .await
        .context("Failed to read token response body")?;

    if !status.is_success() {
        if let Ok(err) = serde_json::from_str::<OAuthErrorResponse>(&body) {
            anyhow::bail!(
                "xAI OAuth error: {} - {}",
                err.error,
                err.error_description.unwrap_or_default()
            );
        }
        anyhow::bail!("xAI OAuth token exchange failed ({}): {}", status, body);
    }

    let token_response: TokenResponse =
        serde_json::from_str(&body).context("Failed to parse token response")?;

    let expires_at = token_response
        .expires_in
        .map(|secs| Utc::now() + chrono::Duration::seconds(secs));

    Ok(TokenSet {
        access_token: token_response.access_token,
        refresh_token: token_response.refresh_token,
        id_token: token_response.id_token,
        expires_at,
        token_type: token_response.token_type,
        scope: token_response.scope,
    })
}

// ── Token refresh (public client — no client_secret) ────────────────────

pub async fn refresh_token(
    client: &Client,
    client_id: &str,
    refresh_token_str: &str,
    token_endpoint: &str,
) -> Result<TokenSet> {
    let form = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token_str),
        ("client_id", client_id),
    ];

    let response = client
        .post(token_endpoint)
        .form(&form)
        .send()
        .await
        .context("Failed to send xAI token refresh request")?;

    let status = response.status();
    let body = response
        .text()
        .await
        .context("Failed to read refresh response body")?;

    if !status.is_success() {
        if let Ok(err) = serde_json::from_str::<OAuthErrorResponse>(&body) {
            anyhow::bail!(
                "xAI OAuth refresh error: {} - {}",
                err.error,
                err.error_description.unwrap_or_default()
            );
        }
        anyhow::bail!("xAI OAuth token refresh failed ({}): {}", status, body);
    }

    let token_response: TokenResponse =
        serde_json::from_str(&body).context("Failed to parse refresh response")?;

    let expires_at = token_response
        .expires_in
        .map(|secs| Utc::now() + chrono::Duration::seconds(secs));

    let refresh_token = token_response
        .refresh_token
        .unwrap_or_else(|| refresh_token_str.to_string());

    Ok(TokenSet {
        access_token: token_response.access_token,
        refresh_token: Some(refresh_token),
        id_token: token_response.id_token,
        expires_at,
        token_type: token_response.token_type,
        scope: token_response.scope,
    })
}

// ── Device code flow ────────────────────────────────────────────────────

pub async fn start_device_code_flow(
    client: &Client,
    client_id: &str,
    device_code_endpoint: &str,
) -> Result<DeviceCodeStart> {
    let form = [("client_id", client_id), ("scope", XAI_OAUTH_SCOPES)];

    let response = client
        .post(device_code_endpoint)
        .form(&form)
        .send()
        .await
        .context("Failed to start xAI device code flow")?;

    let status = response.status();
    let body = response
        .text()
        .await
        .context("Failed to read device code response")?;

    if !status.is_success() {
        if let Ok(err) = serde_json::from_str::<OAuthErrorResponse>(&body) {
            anyhow::bail!(
                "xAI device code error: {} - {}",
                err.error,
                err.error_description.unwrap_or_default()
            );
        }
        anyhow::bail!("xAI device code flow failed ({}): {}", status, body);
    }

    let device_response: DeviceCodeResponse =
        serde_json::from_str(&body).context("Failed to parse device code response")?;

    Ok(DeviceCodeStart {
        device_code: device_response.device_code,
        user_code: device_response.user_code,
        verification_uri: device_response.verification_url,
        verification_uri_complete: device_response.verification_uri_complete,
        expires_in: device_response.expires_in.unwrap_or(300),
        interval: device_response.interval.unwrap_or(5),
    })
}

pub async fn poll_device_code_token(
    client: &Client,
    client_id: &str,
    device_code: &str,
    interval: u64,
    token_endpoint: &str,
) -> Result<TokenSet> {
    loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;

        let form = [
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("device_code", device_code),
            ("client_id", client_id),
        ];

        let response = client
            .post(token_endpoint)
            .form(&form)
            .send()
            .await
            .context("Failed to poll xAI device code token")?;

        let status = response.status();
        let body = response
            .text()
            .await
            .context("Failed to read device code token response")?;

        if status == 200 {
            let token_response: TokenResponse = serde_json::from_str(&body)
                .context("Failed to parse device code token response")?;

            let expires_at = token_response
                .expires_in
                .map(|secs| Utc::now() + chrono::Duration::seconds(secs));

            return Ok(TokenSet {
                access_token: token_response.access_token,
                refresh_token: token_response.refresh_token,
                id_token: token_response.id_token,
                expires_at,
                token_type: token_response.token_type,
                scope: token_response.scope,
            });
        }

        if let Ok(err) = serde_json::from_str::<OAuthErrorResponse>(&body) {
            match err.error.as_str() {
                "authorization_pending" => continue,
                "slow_down" => {
                    tokio::time::sleep(Duration::from_secs(interval)).await;
                    continue;
                }
                "expired_token" => anyhow::bail!("Device code expired"),
                _ => anyhow::bail!(
                    "Device code error: {} - {}",
                    err.error,
                    err.error_description.unwrap_or_default()
                ),
            }
        }

        anyhow::bail!("Device code polling failed ({}): {}", status, body);
    }
}

// ── PKCE browser flow (public client) ───────────────────────────────────

pub async fn run_pkce_flow(client: &Client) -> Result<TokenSet> {
    use crate::auth::oauth_common::generate_pkce_state;

    let endpoints = discover_endpoints(client).await;
    let pkce = generate_pkce_state();
    let auth_url = build_authorize_url(XAI_PUBLIC_CLIENT_ID, &pkce, &endpoints.authorize_url)?;

    let listener = TcpListener::bind("127.0.0.1:56121")
        .await
        .context("Failed to bind to 127.0.0.1:56121")?;

    println!("Opening browser for xAI OAuth login...");
    println!("If the browser does not open, visit:\n{}\n", auth_url);

    // Try to open browser (non-blocking, ignore errors)
    let url_clone = auth_url.clone();
    std::thread::spawn(move || {
        let _ = webbrowser::open(&url_clone);
    });

    println!("Waiting for callback...");

    let (mut socket, _) = tokio::time::timeout(Duration::from_secs(180), listener.accept())
        .await
        .context("Timed out waiting for OAuth callback (180s)")?
        .context("Failed to accept connection")?;

    let mut buffer = [0u8; 8192];
    let n = socket
        .read(&mut buffer)
        .await
        .context("Failed to read request")?;

    let request = String::from_utf8_lossy(&buffer[..n]);
    let code = extract_code_from_callback(&request)?;

    // Send a proper HTTP response with Connection: close so the browser
    // doesn't hang waiting for more data.
    let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\nContent-Length: 187\r\n\r\n<!DOCTYPE html><html><head><title>OK</title></head><body style='font-family:sans-serif;text-align:center;padding:2em'><h1>&#x2705; Authentication successful!</h1><p>You can close this tab and return to the terminal.</p></body></html>";
    socket
        .write_all(response.as_bytes())
        .await
        .context("Failed to send response")?;
    socket.shutdown().await.ok();

    exchange_code_for_tokens(
        client,
        XAI_PUBLIC_CLIENT_ID,
        &code,
        &pkce,
        &endpoints.token_url,
    )
    .await
}

fn extract_code_from_callback(request: &str) -> Result<String> {
    let lines: Vec<&str> = request.lines().collect();
    if lines.is_empty() {
        anyhow::bail!("Empty request");
    }

    let path_line = lines[0];
    if !path_line.starts_with("GET ") {
        anyhow::bail!("Not a GET request");
    }

    let parts: Vec<&str> = path_line.split_whitespace().collect();
    if parts.len() < 2 {
        anyhow::bail!("Invalid request line");
    }

    let path = parts[1];
    let query_start = path.find('?');
    let query = match query_start {
        Some(idx) => &path[idx + 1..],
        None => anyhow::bail!("No query string in callback"),
    };

    let params = parse_query_params(query);
    let code = params.get("code").context("Missing code parameter")?;
    Ok(url_decode(code))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_authorize_url() {
        use crate::auth::oauth_common::PkceState;
        let pkce = PkceState {
            code_verifier: "test_verifier".to_string(),
            code_challenge: "test_challenge".to_string(),
            state: "test_state".to_string(),
        };
        let url = build_authorize_url("test_client_id", &pkce, XAI_OAUTH_AUTHORIZE_URL).unwrap();
        assert!(url.contains("accounts.x.ai"));
        assert!(url.contains("test_client_id"));
        assert!(url.contains("test_challenge"));
    }

    #[test]
    fn test_public_client_id_is_set() {
        assert!(!XAI_PUBLIC_CLIENT_ID.is_empty());
        assert!(XAI_PUBLIC_CLIENT_ID.contains('-'));
    }

    #[test]
    fn test_scopes_include_api_access() {
        assert!(XAI_OAUTH_SCOPES.contains("api:access"));
        assert!(XAI_OAUTH_SCOPES.contains("grok-cli:access"));
        assert!(XAI_OAUTH_SCOPES.contains("offline_access"));
    }

    #[test]
    fn test_validate_xai_endpoint() {
        assert!(validate_xai_endpoint("https://accounts.x.ai/oauth/token").is_ok());
        assert!(validate_xai_endpoint("https://auth.x.ai/oauth/authorize").is_ok());
        assert!(validate_xai_endpoint("https://evil.com/oauth").is_err());
        assert!(validate_xai_endpoint("https://x.ai.evil.com/oauth").is_err());
    }
}
