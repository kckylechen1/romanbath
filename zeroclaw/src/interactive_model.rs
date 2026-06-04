//! Interactive `zeroclaw model` command — provider picker, auth flow, model selector.
//!
//! Inspired by HermesAgent's `hermes model`. Three-stage interactive flow:
//! 1. Provider picker (FuzzySelect via dialoguer)
//! 2. Auth flow (auto-triggered when no credential exists)
//! 3. Model picker (FuzzySelect from catalog)
//! 4. Persist selection to config

use anyhow::{Context, Result, bail};
use console::style;
use dialoguer::{FuzzySelect, Input, Password};
use std::io::IsTerminal;
use zeroclaw_providers::auth::{AuthFlowContext, AuthProvider, AuthProviderFlow, AuthService};

use crate::config::Config;

// ── Provider definitions ───────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
enum InteractiveProvider {
    Anthropic,
    OpenaiCodex,
    Gemini,
    Xai,
    OpenRouter,
    Deepseek,
    Ollama,
}

impl InteractiveProvider {
    fn all() -> &'static [Self] {
        &[
            Self::Anthropic,
            Self::OpenaiCodex,
            Self::Gemini,
            Self::Xai,
            Self::OpenRouter,
            Self::Deepseek,
            Self::Ollama,
        ]
    }

    fn display_name(&self) -> &str {
        match self {
            Self::Anthropic => "Anthropic (Claude)",
            Self::OpenaiCodex => "OpenAI (Codex)",
            Self::Gemini => "Google (Gemini)",
            Self::Xai => "xAI (Grok)",
            Self::OpenRouter => "OpenRouter",
            Self::Deepseek => "DeepSeek",
            Self::Ollama => "Ollama (local)",
        }
    }

    fn canonical_family(&self) -> &str {
        match self {
            Self::Anthropic => "anthropic",
            Self::OpenaiCodex => "openai",
            Self::Gemini => "gemini",
            Self::Xai => "xai",
            Self::OpenRouter => "openrouter",
            Self::Deepseek => "deepseek",
            Self::Ollama => "ollama",
        }
    }

    fn auth_kind(self) -> AuthKind {
        match self {
            Self::Anthropic | Self::OpenRouter | Self::Deepseek => AuthKind::ApiKey,
            Self::OpenaiCodex | Self::Gemini | Self::Xai => AuthKind::OAuth,
            Self::Ollama => AuthKind::None,
        }
    }

    /// The auth profile provider name (differs from canonical_family for some).
    fn auth_provider_name(&self) -> &str {
        match self {
            Self::OpenaiCodex => "openai-codex",
            Self::Gemini => "gemini",
            Self::Xai => "xai",
            other => other.canonical_family(),
        }
    }

    fn has_api_key_in_config(self, config: &Config) -> bool {
        config
            .get_prop(&format!(
                "model_providers.{}.default.api_key",
                self.canonical_family()
            ))
            .is_ok()
    }
}

#[derive(Debug, Clone, Copy)]
enum AuthKind {
    OAuth,
    ApiKey,
    None,
}

// ── Main entry point ────────────────────────────────────────────────────

pub async fn run(
    config: &mut Config,
    provider_override: Option<&str>,
    device_code: bool,
    set_override: Option<&str>,
    show_status: bool,
) -> Result<()> {
    // --status: print current model and exit
    if show_status {
        return show_current_model(config);
    }

    // --set <model>: persist directly and exit
    if let Some(model_id) = set_override {
        let family = provider_override
            .unwrap_or_else(|| config.first_model_provider_type().unwrap_or("openrouter"));
        Box::pin(persist_model(config, family, model_id)).await?;
        return Ok(());
    }

    // Non-interactive environment check
    if !std::io::stdout().is_terminal() {
        bail!(
            "Not a terminal. Use:\n  zeroclaw model --set <model> --provider <family>\n  zeroclaw model --device-code --provider <family>"
        );
    }

    let auth_service = AuthService::from_config(config);
    let client = reqwest::Client::new();

    // Pre-compute auth status for all providers (async)
    let auth_statuses = compute_auth_statuses(&auth_service, config).await;

    // Stage 1: Pick provider
    let provider = if let Some(slug) = provider_override {
        parse_provider(slug)?
    } else {
        pick_provider(config, &auth_statuses).await?
    };

    // Stage 2: Ensure authenticated
    let is_ready = auth_statuses
        .iter()
        .find(|(p, _)| p.canonical_family() == provider.canonical_family())
        .is_some_and(|(_, ready)| *ready)
        || provider.has_api_key_in_config(config);

    if !is_ready {
        Box::pin(ensure_authenticated(
            provider,
            config,
            &auth_service,
            &client,
            device_code,
        ))
        .await?;
    }

    // Stage 3: Pick model
    let model = pick_model(provider, config).await?;

    // Stage 4: Persist
    Box::pin(persist_model(config, provider.canonical_family(), &model)).await
}

/// Pre-compute auth status for all providers in async context.
async fn compute_auth_statuses(
    auth_service: &AuthService,
    config: &Config,
) -> Vec<(InteractiveProvider, bool)> {
    let mut results = Vec::with_capacity(InteractiveProvider::all().len());
    for p in InteractiveProvider::all() {
        let ready = match p.auth_kind() {
            AuthKind::None => true,
            AuthKind::ApiKey => {
                auth_service
                    .get_provider_bearer_token(p.canonical_family(), None)
                    .await
                    .ok()
                    .flatten()
                    .is_some()
                    || p.has_api_key_in_config(config)
            }
            AuthKind::OAuth => auth_service
                .get_profile(p.auth_provider_name(), None)
                .await
                .ok()
                .flatten()
                .is_some(),
        };
        results.push((*p, ready));
    }
    results
}

// ── Stage 1: Provider picker ────────────────────────────────────────────

async fn pick_provider(
    config: &Config,
    auth_statuses: &[(InteractiveProvider, bool)],
) -> Result<InteractiveProvider> {
    let providers = InteractiveProvider::all();
    let current_family = config
        .first_model_provider_type()
        .unwrap_or("")
        .to_ascii_lowercase();

    let items: Vec<String> = providers
        .iter()
        .map(|p| {
            let is_ready = auth_statuses
                .iter()
                .find(|(prov, _)| prov.canonical_family() == p.canonical_family())
                .is_some_and(|(_, ready)| *ready);
            let auth_badge = if is_ready || p.has_api_key_in_config(config) {
                style("OK").green().to_string()
            } else {
                style("setup needed").dim().to_string()
            };
            let current = if p.canonical_family().eq_ignore_ascii_case(&current_family) {
                style(" <-- active").dim().to_string()
            } else {
                String::new()
            };
            format!("{}  [{}]{}", p.display_name(), auth_badge, current)
        })
        .collect();

    let selection = tokio::task::spawn_blocking(move || {
        FuzzySelect::new()
            .with_prompt("Select a provider")
            .items(&items)
            .default(0)
            .interact_opt()
    })
    .await??;

    match selection {
        Some(idx) => Ok(providers[idx]),
        None => bail!("Cancelled"),
    }
}

// ── Stage 2: Auth gate ──────────────────────────────────────────────────

async fn ensure_authenticated(
    provider: InteractiveProvider,
    config: &mut Config,
    auth_service: &AuthService,
    client: &reqwest::Client,
    device_code: bool,
) -> Result<()> {
    match provider.auth_kind() {
        AuthKind::None => Ok(()),
        AuthKind::ApiKey => Box::pin(prompt_api_key(provider, config)).await,
        AuthKind::OAuth => {
            run_oauth_login(provider, config, auth_service, client, device_code).await
        }
    }
}

async fn prompt_api_key(provider: InteractiveProvider, config: &mut Config) -> Result<()> {
    let family = provider.canonical_family();
    println!(
        "\n{} requires an API key.",
        style(provider.display_name()).bold()
    );
    println!(
        "Get one at: {}",
        match provider {
            InteractiveProvider::Anthropic => "https://console.anthropic.com",
            InteractiveProvider::OpenRouter => "https://openrouter.ai/keys",
            InteractiveProvider::Deepseek => "https://platform.deepseek.com/api_keys",
            _ => "",
        }
    );

    let key =
        tokio::task::spawn_blocking(|| Password::new().with_prompt("API key").interact()).await??;

    if key.trim().is_empty() {
        bail!("API key cannot be empty");
    }

    let prop = format!("model_providers.{family}.default.api_key");
    config.set_prop_persistent(&prop, key.trim())?;
    Box::pin(config.save()).await?;
    println!("{} API key saved.", style("OK").green());
    Ok(())
}

async fn run_oauth_login(
    provider: InteractiveProvider,
    config: &Config,
    auth_service: &AuthService,
    client: &reqwest::Client,
    device_code: bool,
) -> Result<()> {
    let auth_provider = match provider {
        InteractiveProvider::OpenaiCodex => AuthProvider::OpenaiCodex,
        InteractiveProvider::Gemini => AuthProvider::Gemini,
        InteractiveProvider::Xai => AuthProvider::Xai,
        _ => bail!("Not an OAuth provider"),
    };

    println!(
        "\nStarting {} authentication...",
        style(provider.display_name()).bold()
    );

    let ctx = AuthFlowContext {
        config,
        auth_service,
        client,
    };
    let flow = auth_provider.flow();
    flow.login(&ctx, "default", device_code, None).await?;

    println!("{} Authenticated successfully.", style("OK").green());
    Ok(())
}

// ── Stage 3: Model picker ───────────────────────────────────────────────

async fn pick_model(provider: InteractiveProvider, config: &Config) -> Result<String> {
    let family = provider.canonical_family();
    let current_model: Option<String> = config
        .get_prop(&format!("model_providers.{family}.default.model"))
        .ok();

    // Try to fetch model catalog
    let models = zeroclaw_providers::catalog::list_models_for_family(family)
        .await
        .unwrap_or_default();

    if models.is_empty() {
        println!(
            "\nNo model catalog available for {}.",
            provider.display_name()
        );
        let model = tokio::task::spawn_blocking(move || {
            Input::<String>::new()
                .with_prompt("Enter model ID")
                .interact_text()
        })
        .await??;
        return Ok(model);
    }

    // Build display list with current model marker
    let current_model_clone = current_model.clone();
    let display_items: Vec<String> = models
        .iter()
        .map(|m| {
            let is_current = current_model_clone
                .as_ref()
                .is_some_and(|c| c.eq_ignore_ascii_case(m));
            if is_current {
                format!("{}  <-- current", m)
            } else {
                m.clone()
            }
        })
        .collect();

    let default_idx = current_model
        .as_ref()
        .and_then(|c| models.iter().position(|m| m.eq_ignore_ascii_case(c)));

    println!(
        "\n{} models available for {}.",
        models.len(),
        provider.display_name()
    );

    let selection = tokio::task::spawn_blocking(move || {
        let mut select = FuzzySelect::new()
            .with_prompt("Select a model")
            .items(&display_items);
        if let Some(idx) = default_idx {
            select = select.default(idx);
        }
        select.interact_opt()
    })
    .await??;

    match selection {
        Some(idx) => Ok(models[idx].clone()),
        None => bail!("Cancelled"),
    }
}

// ── Stage 4: Persist ────────────────────────────────────────────────────

async fn persist_model(config: &mut Config, family: &str, model: &str) -> Result<()> {
    let prop = format!("model_providers.{family}.default.model");
    config.set_prop_persistent(&prop, model)?;
    Box::pin(config.save()).await?;
    println!(
        "{} Model set to: {} (via {})",
        style("OK").green(),
        style(model).bold(),
        family
    );
    Ok(())
}

// ── Status display ──────────────────────────────────────────────────────

fn show_current_model(config: &Config) -> Result<()> {
    let family = config.first_model_provider_type().unwrap_or("(none)");
    let model = config
        .get_prop(&format!("model_providers.{family}.default.model"))
        .unwrap_or_else(|_| "(not set)".to_string());

    println!("Provider: {}", style(family).bold());
    println!("Model:    {}", style(&model).bold());
    Ok(())
}

// ── Helpers ─────────────────────────────────────────────────────────────

fn parse_provider(slug: &str) -> Result<InteractiveProvider> {
    let slug_lower = slug.to_ascii_lowercase();
    for p in InteractiveProvider::all() {
        if p.canonical_family() == slug_lower
            || p.display_name().to_ascii_lowercase().contains(&slug_lower)
        {
            return Ok(*p);
        }
    }
    // Also accept common aliases
    match slug_lower.as_str() {
        "grok" | "x-ai" | "x.ai" => Ok(InteractiveProvider::Xai),
        "claude" => Ok(InteractiveProvider::Anthropic),
        "openai" | "codex" => Ok(InteractiveProvider::OpenaiCodex),
        "google" | "gemini-cli" => Ok(InteractiveProvider::Gemini),
        "or" => Ok(InteractiveProvider::OpenRouter),
        "ds" => Ok(InteractiveProvider::Deepseek),
        _ => bail!(
            "Unknown provider {:?}. Supported: {}",
            slug,
            InteractiveProvider::all()
                .iter()
                .map(|p| p.canonical_family())
                .collect::<Vec<_>>()
                .join(", ")
        ),
    }
}
