//! xAI/Grok OAuth2 authentication flow.
//!
//! Supports:
//! - Authorization code flow with PKCE (browser login)
//! - Device code flow for headless environments
//! - Token refresh for long-lived sessions
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

pub const XAI_OAUTH_AUTHORIZE_URL: &str = "https://accounts.x.ai/oauth/authorize";
pub const XAI_OAUTH_TOKEN_URL: &str = "https://accounts.x.ai/oauth/token";
pub const XAI_OAUTH_DEVICE_CODE_URL: &str = "https://accounts.x.ai/oauth/device_code";
pub const XAI_OAUTH_REDIRECT_URI: &str = "http://localhost:1457/auth/callback";

/// Scopes required for xAI API access.
pub const XAI_OAUTH_SCOPES: &str = "openid profile email";

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

pub fn build_authorize_url(
    client_id: &str,
    pkce: &crate::auth::oauth_common::PkceState,
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

    Ok(format!("{}?{}", XAI_OAUTH_AUTHORIZE_URL, encoded.join("&")))
}

pub async fn exchange_code_for_tokens(
    client: &Client,
    client_id: &str,
    client_secret: &str,
    code: &str,
    pkce: &crate::auth::oauth_common::PkceState,
) -> Result<TokenSet> {
    let form = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", XAI_OAUTH_REDIRECT_URI),
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("code_verifier", &pkce.code_verifier),
    ];

    let response = client
        .post(XAI_OAUTH_TOKEN_URL)
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

pub async fn refresh_token(
    client: &Client,
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<TokenSet> {
    let form = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", client_id),
        ("client_secret", client_secret),
    ];

    let response = client
        .post(XAI_OAUTH_TOKEN_URL)
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

    // Prefer the new refresh token returned by the rotation; fall back to the
    // original when the provider does not issue a replacement.
    let refresh_token = token_response
        .refresh_token
        .unwrap_or_else(|| refresh_token.to_string());

    Ok(TokenSet {
        access_token: token_response.access_token,
        refresh_token: Some(refresh_token),
        id_token: token_response.id_token,
        expires_at,
        token_type: token_response.token_type,
        scope: token_response.scope,
    })
}

pub async fn start_device_code_flow(client: &Client, client_id: &str) -> Result<DeviceCodeStart> {
    let form = [("client_id", client_id), ("scope", XAI_OAUTH_SCOPES)];

    let response = client
        .post(XAI_OAUTH_DEVICE_CODE_URL)
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
    client_secret: &str,
    device_code: &str,
    interval: u64,
) -> Result<TokenSet> {
    loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;

        let form = [
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("device_code", device_code),
            ("client_id", client_id),
            ("client_secret", client_secret),
        ];

        let response = client
            .post(XAI_OAUTH_TOKEN_URL)
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

pub async fn run_pkce_flow(client_id: &str, client_secret: &str) -> Result<TokenSet> {
    use crate::auth::oauth_common::generate_pkce_state;

    let pkce = generate_pkce_state();
    let auth_url = build_authorize_url(client_id, &pkce)?;

    // Bind the TCP listener *before* displaying the URL so there is no race
    // between the user's browser hitting the callback and us starting to
    // listen. This also eliminates the need for blocking stdin — the browser
    // connects directly to the already-bound port.
    let listener = TcpListener::bind("127.0.0.1:1457")
        .await
        .context("Failed to bind to localhost:1457")?;

    println!("Please open the following URL in your browser to complete xAI OAuth login:");
    println!("{}", auth_url);
    println!("\nWaiting for callback on http://localhost:1457/auth/callback...");

    let (mut socket, _) = tokio::time::timeout(Duration::from_secs(180), listener.accept())
        .await
        .context("Timed out waiting for OAuth callback (180s)")?
        .context("Failed to accept connection")?;

    let mut buffer = [0u8; 4096];
    let n = socket
        .read(&mut buffer)
        .await
        .context("Failed to read request")?;

    let request = String::from_utf8_lossy(&buffer[..n]);
    let code = extract_code_from_callback(&request)?;

    // Send success response
    let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n\
        <html><body><h1>Authentication successful!</h1>\
        <p>You can close this window and return to the terminal.</p></body></html>";
    socket
        .write_all(response.as_bytes())
        .await
        .context("Failed to send response")?;

    let client = Client::new();
    exchange_code_for_tokens(&client, client_id, client_secret, &code, &pkce).await
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
        let url = build_authorize_url("test_client_id", &pkce).unwrap();
        assert!(url.contains("accounts.x.ai"));
        assert!(url.contains("test_client_id"));
        assert!(url.contains("test_challenge"));
    }
}
