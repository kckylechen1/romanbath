//! WebSocket agent chat handler.
//!
//! Connect: `ws://host:port/ws/chat?session_id=ID&name=My+Session`
//!
//! Protocol:
//! ```text
//! Server -> Client: {"type":"session_start","session_id":"...","name":"...","resumed":true,"message_count":42}
//! Client -> Server: {"type":"message","content":"Hello"}
//! Server -> Client: {"type":"chunk","content":"Hi! "}
//! Server -> Client: {"type":"tool_call","name":"shell","args":{...}}
//! Server -> Client: {"type":"tool_result","name":"shell","output":"..."}
//! Server -> Client: {"type":"done","full_response":"..."}
//! ```
//!
//! ## Tool approvals
//!
//! When supervised-mode tool calls hit the `ApprovalManager`, the server
//! emits an `approval_request` and pauses the tool loop until the client
//! responds. Mirrors the Telegram inline-keyboard / CLI Y/N/A pattern,
//! over the WS frame transport.
//!
//! ```text
//! Server -> Client: {
//!     "type": "approval_request",
//!     "request_id": "<uuid>",
//!     "tool": "shell",
//!     "arguments_summary": "command: git status",
//!     "timeout_secs": 120
//! }
//! Client -> Server: {
//!     "type": "approval_response",
//!     "request_id": "<uuid>",
//!     "decision": "approve" | "deny" | "always"
//! }
//! ```
//!
//! `approve` runs the tool once, `always` adds the tool to the session
//! allowlist for the rest of the conversation, `deny` returns a structured
//! error to the model. When no client is connected, or the client
//! disconnects mid-prompt, the tool call is auto-denied after `timeout_secs`.
//!
//! ### `arguments_summary` security boundary
//!
//! `arguments_summary` is a human-readable string the runtime synthesises
//! for the operator (e.g. `"command: git status"`, `"path: /etc/hosts"`).
//! It is render-only; the operator's approve/deny choice attaches to the
//! `request_id`, never to the summary string. The runtime must not echo
//! any `#[secret]` or `#[derived_from_secret]` field (auth tokens, API
//! keys, OAuth secrets) into the summary. The agent's tool loop runs
//! tool args through `zeroclaw_runtime::approval::summarize_args` before
//! the request reaches this transport; do not stringify raw args here.
//!
//! Query params:
//! - `session_id` — resume or create a session (default: new UUID)
//! - `name` — optional human-readable label for the session
//! - `token` — bearer auth token (alternative to Authorization header)

use super::AppState;
use crate::ws_approval::{PendingApprovals, WsApprovalChannel, new_pending_approvals};
use axum::{
    extract::{
        Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, header},
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use zeroclaw_api::channel::ChannelApprovalResponse;

/// Default wall-clock budget for the operator to answer an
/// `approval_request` frame before the channel auto-denies. Mirrors the
/// channel-side default on `TelegramConfig::approval_timeout_secs`.
const WS_APPROVAL_TIMEOUT_SECS: u64 = 120;

/// Optional connection parameters sent as the first WebSocket message.
///
/// If the first message after upgrade is `{"type":"connect",...}`, these
/// parameters are extracted and an acknowledgement is sent back. Old clients
/// that send `{"type":"message",...}` as the first frame still work — the
/// message is processed normally (backward-compatible).
#[derive(Debug, Deserialize)]
struct ConnectParams {
    #[serde(rename = "type")]
    msg_type: String,
    /// Client-chosen session ID for memory persistence
    #[serde(default)]
    session_id: Option<String>,
    /// Device name for device registry tracking
    #[serde(default)]
    device_name: Option<String>,
    /// Client capabilities
    #[serde(default)]
    capabilities: Vec<String>,
    /// Project root / working directory for this session.
    #[serde(default, alias = "workspaceDir", alias = "workspace_dir")]
    cwd: Option<String>,
    /// Character card name for personality-driven chat
    #[serde(default)]
    character_name: Option<String>,
    /// Character mode: "play", "soul", "chat"
    #[serde(default)]
    character_mode: Option<String>,
    /// User display name for character card prompt building
    #[serde(default)]
    user_name: Option<String>,
    /// User persona / self-description ("who the user is"), injected into the
    /// card prompt so the character knows who it's talking to. Per-connection
    /// identity supplied by the client — the SSE path takes the same value as
    /// `user_description`. Any thin client (web, native) sends it here.
    #[serde(default)]
    user_description: Option<String>,
}

/// The sub-protocol we support for the chat WebSocket.
const WS_PROTOCOL: &str = "zeroclaw.v1";

/// Prefix used in `Sec-WebSocket-Protocol` to carry a bearer token.
const BEARER_SUBPROTO_PREFIX: &str = "bearer.";

#[derive(Deserialize)]
pub struct WsQuery {
    pub token: Option<String>,
    pub session_id: Option<String>,
    /// Optional human-readable name for the session.
    pub name: Option<String>,
    /// Configured agent alias to run as. Required — every WebSocket
    /// session is bound to an explicit agent (no default agent exists).
    #[serde(default, alias = "agentAlias", alias = "agent")]
    pub agent_alias: Option<String>,
    /// Project root / working directory for this session.
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default, alias = "workspaceDir", alias = "workspace_dir")]
    pub workspace_dir: Option<String>,
}

/// Extract a bearer token from WebSocket-compatible sources.
///
/// Precedence (first non-empty wins):
/// 1. `Authorization: Bearer <token>` header
/// 2. `Sec-WebSocket-Protocol: bearer.<token>` subprotocol
/// 3. `?token=<token>` query parameter
///
/// Browsers cannot set custom headers on `new WebSocket(url)`, so the query
/// parameter and subprotocol paths are required for browser-based clients.
fn extract_ws_token<'a>(headers: &'a HeaderMap, query_token: Option<&'a str>) -> Option<&'a str> {
    // 1. Authorization header
    if let Some(t) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|auth| auth.strip_prefix("Bearer "))
        && !t.is_empty()
    {
        return Some(t);
    }

    // 2. Sec-WebSocket-Protocol: bearer.<token>
    if let Some(t) = headers
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .and_then(|protos| {
            protos
                .split(',')
                .map(|p| p.trim())
                .find_map(|p| p.strip_prefix(BEARER_SUBPROTO_PREFIX))
        })
        && !t.is_empty()
    {
        return Some(t);
    }

    // 3. ?token= query parameter
    if let Some(t) = query_token
        && !t.is_empty()
    {
        return Some(t);
    }

    None
}

/// GET /ws/chat — WebSocket upgrade for agent chat
pub async fn handle_ws_chat(
    State(state): State<AppState>,
    Query(params): Query<WsQuery>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    // Auth: check header, subprotocol, then query param (precedence order)
    if state.pairing.require_pairing() {
        let token = extract_ws_token(&headers, params.token.as_deref()).unwrap_or("");
        if !state.pairing.is_authenticated(token) {
            return (
                axum::http::StatusCode::UNAUTHORIZED,
                "Unauthorized — provide Authorization header, Sec-WebSocket-Protocol bearer, or ?token= query param",
            )
                .into_response();
        }
    }

    // Echo Sec-WebSocket-Protocol if the client requests our sub-protocol.
    let ws = if headers
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|protos| protos.split(',').any(|p| p.trim() == WS_PROTOCOL))
    {
        ws.protocols([WS_PROTOCOL])
    } else {
        ws
    };

    // Reject the upgrade up-front when the client didn't pick an agent.
    // No default — every WS session is bound to an explicit agent.
    let Some(agent_alias) = params.agent_alias.filter(|s| !s.trim().is_empty()) else {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            "Missing required `agent` query parameter — pass `?agent=<alias>` matching a configured [agents.<alias>] entry.",
        )
            .into_response();
    };
    {
        let cfg = state.config.read();
        if cfg.agent(&agent_alias).is_none() {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                format!(
                    "Unknown agent `{agent_alias}` — no [agents.{agent_alias}] entry configured."
                ),
            )
                .into_response();
        }
    }

    let session_id = params.session_id;
    let session_name = params.name;
    let session_cwd = params.cwd.or(params.workspace_dir);
    ws.on_upgrade(move |socket| {
        handle_socket(
            socket,
            state,
            agent_alias,
            session_id,
            session_name,
            session_cwd,
        )
    })
    .into_response()
}

/// Gateway session key prefix to avoid collisions with channel sessions.
const GW_SESSION_PREFIX: &str = "gw_";

async fn resolve_ws_memory_handle(
    config: &zeroclaw_config::schema::Config,
    agent_alias: &str,
) -> anyhow::Result<Option<Arc<dyn zeroclaw_memory::Memory>>> {
    if config.agent(agent_alias).is_some_and(|agent| {
        matches!(
            agent.memory.backend,
            zeroclaw_config::multi_agent::MemoryBackendKind::None
        )
    }) {
        return Ok(None);
    }

    let api_key = config
        .resolved_model_provider_for_agent(agent_alias)
        .and_then(|(_, _, cfg)| cfg.api_key.clone());
    zeroclaw_memory::create_memory_for_agent(config, agent_alias, api_key.as_deref())
        .await
        .map(Some)
}

/// Build a sigil DreamingPipeline for the agent, attaching an LLM
/// enricher when `agents.<alias>.enricher_provider` is set. Empty ref
/// → pure-Rust heuristics only (the historical default before this
/// hook existed).
///
/// This is called fire-and-forget from the chat-completion path; failures
/// are logged and downgraded to a no-enricher pipeline so a misconfigured
/// `enricher_provider` never breaks the chat surface.
async fn resolve_ws_dreaming_pipeline(
    config: &zeroclaw_config::schema::Config,
    agent_alias: &str,
    data_dir: &Path,
) -> zeroclaw_memory_sigil::DreamingPipeline {
    let db_path = data_dir.join("chat_memory");
    let db_path_str = db_path.to_string_lossy().to_string();
    let pipeline = zeroclaw_memory_sigil::DreamingPipeline::new(&db_path_str);

    let enricher_ref = config
        .agent(agent_alias)
        .map(|a| a.enricher_provider.as_str().trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("");
    if enricher_ref.is_empty() {
        return pipeline;
    }

    // Resolve model + provider from the same `[providers.models.<type>.<alias>]`
    // entry that classifier_provider uses — single source of truth.
    let (type_key, alias_key) = match enricher_ref.split_once('.') {
        Some(parts) => parts,
        None => {
            ::zeroclaw_log::record!(
                WARN,
                ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                    .with_attrs(::serde_json::json!({"enricher_provider": enricher_ref})),
                "enricher_provider must be dotted `<type>.<alias>`; dreaming runs heuristics-only"
            );
            return pipeline;
        }
    };
    let model_cfg = match config.providers.models.find(type_key, alias_key) {
        Some(cfg) => cfg,
        None => {
            ::zeroclaw_log::record!(
                WARN,
                ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                    .with_attrs(::serde_json::json!({"enricher_provider": enricher_ref})),
                "enricher_provider references unknown [providers.models] entry; dreaming runs heuristics-only"
            );
            return pipeline;
        }
    };
    let model = match model_cfg.model.as_deref() {
        Some(m) if !m.is_empty() => m.to_string(),
        _ => {
            ::zeroclaw_log::record!(
                WARN,
                ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                    .with_attrs(::serde_json::json!({"enricher_provider": enricher_ref})),
                "enricher_provider entry has no `model` field; dreaming runs heuristics-only"
            );
            return pipeline;
        }
    };

    let opts = zeroclaw_providers::provider_runtime_options_from_config(config);
    let provider_result = zeroclaw_providers::create_resilient_model_provider_from_ref(
        config,
        enricher_ref,
        model_cfg.api_key.as_deref(),
        model_cfg.uri.as_deref(),
        &config.reliability,
        &opts,
    );
    let provider: Arc<dyn zeroclaw_api::model_provider::ModelProvider> = match provider_result {
        Ok(p) => Arc::from(p),
        Err(e) => {
            ::zeroclaw_log::record!(
                WARN,
                ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                    .with_outcome(::zeroclaw_log::EventOutcome::Unknown)
                    .with_attrs(::serde_json::json!({
                        "enricher_provider": enricher_ref,
                        "error": format!("{e:#}"),
                    })),
                "Failed to initialize enricher_provider; dreaming runs heuristics-only"
            );
            return pipeline;
        }
    };

    // Same model handles extract (Light) and distill (Deep/REM) for now.
    // The MemoryEnricher API allows splitting them later if a user wants
    // a cheaper extract model and a stronger distill model.
    let enricher = Arc::new(zeroclaw_memory_sigil::MemoryEnricher::with_single_provider(
        provider, &model, &model,
    ));
    ::zeroclaw_log::record!(
        INFO,
        ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note).with_attrs(
            ::serde_json::json!({
                "enricher_provider": enricher_ref,
                "model": model.as_str(),
            })
        ),
        "enricher_provider override active for dreaming"
    );
    pipeline.with_enricher(enricher)
}

async fn handle_socket(
    socket: WebSocket,
    state: AppState,
    agent_alias: String,
    session_id: Option<String>,
    session_name: Option<String>,
    session_cwd: Option<String>,
) {
    let (mut sender, mut receiver) = socket.split();

    // Resolve session ID: use provided or generate a new UUID
    let session_id = session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let session_key = format!("{GW_SESSION_PREFIX}{session_id}");
    // Match the sanitized form persisted by memory backend migrations.
    let mut memory_session_id = zeroclaw_api::session_keys::sanitize_session_key(&session_id);

    // Hydrate session metadata from persistence (if available). Agent
    // construction is deferred until after the optional `connect` frame so the
    // client can provide a per-session cwd for the security sandbox root.
    let config = state.config.read().clone();
    let ws_memory = match resolve_ws_memory_handle(&config, &agent_alias).await {
        Ok(memory) => memory,
        Err(e) => {
            ::zeroclaw_log::record!(
                WARN,
                ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                    .with_outcome(::zeroclaw_log::EventOutcome::Failure)
                    .with_attrs(::serde_json::json!({
                        "agent": &agent_alias,
                        "error": format!("{e:#}"),
                    })),
                "WS per-agent memory resolution failed; consolidation disabled for connection"
            );
            None
        }
    };
    let mut resumed = false;
    let mut message_count: usize = 0;
    let mut effective_name: Option<String> = None;
    let mut stored_messages = Vec::new();
    if let Some(ref backend) = state.session_backend {
        // Resume from the ACTIVE PATH of the conversation tree (root → active
        // leaf), not the raw row order. For a legacy purely-linear session this
        // is byte-identical to `load()`; for a branched one it seeds only the
        // branch the client last had selected.
        let messages = backend.load_active_path(&session_key);
        if !messages.is_empty() {
            message_count = messages.len();
            stored_messages = messages;
            resumed = true;
        }
        // Set session name if provided (non-empty) on connect
        if let Some(ref name) = session_name
            && !name.is_empty()
        {
            let _ = backend.set_session_name(&session_key, name);
            effective_name = Some(name.clone());
        }
        // If no name was provided via query param, load the stored name
        if effective_name.is_none() {
            effective_name = backend.get_session_name(&session_key).unwrap_or(None);
        }
        // Stamp the agent alias so future /api/sessions queries and
        // per-agent filters can attribute this session to its agent.
        let _ = backend.set_session_agent_alias(&session_key, &agent_alias);
    }

    // Send session_start message to client
    let mut session_start = serde_json::json!({
        "type": "session_start",
        "session_id": session_id,
        "resumed": resumed,
        "message_count": message_count,
    });
    if let Some(ref name) = effective_name {
        session_start["name"] = serde_json::Value::String(name.clone());
    }
    let _ = sender
        .send(Message::Text(session_start.to_string().into()))
        .await;

    // ── History snapshot ────────────────────────────────────────────
    // Push the full conversation TREE (every branch, not just the active
    // path) plus the active leaf, so a thin client can render the tree it no
    // longer owns. Additive frame: pre-Solution-B clients ignore unknown
    // frame types, so this is safe to always send. Only emitted when there is
    // history to send.
    if let Some(ref backend) = state.session_backend {
        let nodes = backend.load_tree(&session_key);
        if !nodes.is_empty() {
            let active_leaf = backend.get_active_leaf(&session_key);
            let node_json: Vec<serde_json::Value> = nodes
                .iter()
                .map(|n| {
                    serde_json::json!({
                        "id": n.msg_id,
                        "parent_id": n.parent_id,
                        "role": n.role,
                        "content": n.content,
                        "author_id": n.author_id,
                        "status": n.status,
                        "meta": n.meta,
                        "timestamp": n.created_at.map(|d| d.to_rfc3339()),
                    })
                })
                .collect();
            let snapshot = serde_json::json!({
                "type": "history_snapshot",
                "nodes": node_json,
                "active_leaf": active_leaf,
            });
            let _ = sender
                .send(Message::Text(snapshot.to_string().into()))
                .await;
        }
    }

    // ── Optional connect handshake ──────────────────────────────────
    // The first message may be a `{"type":"connect",...}` frame carrying
    // connection parameters.  If it is, we extract the params, send an
    // ack, and proceed to the normal message loop.  If the first message
    // is a regular `{"type":"message",...}` frame, we fall through and
    // process it immediately (backward-compatible).
    let mut first_msg_fallback: Option<String> = None;
    let mut requested_cwd = session_cwd;
    let mut character_name: Option<String> = None;
    let mut character_mode: Option<String> = None;
    let mut user_name: Option<String> = None;
    let mut user_description: Option<String> = None;

    if let Some(first) = receiver.next().await {
        match first {
            Ok(Message::Text(text)) => {
                if let Ok(cp) = serde_json::from_str::<ConnectParams>(&text) {
                    if cp.msg_type == "connect" {
                        ::zeroclaw_log::record!(DEBUG, ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note).with_attrs(::serde_json::json!({"session_id": cp.session_id, "device_name": cp.device_name, "capabilities": cp.capabilities, "cwd": cp.cwd})), "WebSocket connect params received");
                        if let Some(sid) = &cp.session_id {
                            memory_session_id =
                                zeroclaw_api::session_keys::sanitize_session_key(sid);
                            ::zeroclaw_log::record!(
                                DEBUG,
                                ::zeroclaw_log::Event::new(
                                    module_path!(),
                                    ::zeroclaw_log::Action::Note
                                )
                                .with_attrs(::serde_json::json!({"session_id": sid})),
                                "WebSocket connect session override received"
                            );
                        }
                        if cp.cwd.is_some() {
                            requested_cwd = cp.cwd;
                        }
                        if cp.character_name.is_some() {
                            character_name = cp.character_name;
                            character_mode = cp.character_mode;
                            user_name = cp.user_name;
                            user_description = cp.user_description;
                        }
                        let ack = serde_json::json!({
                            "type": "connected",
                            "message": "Connection established"
                        });
                        let _ = sender.send(Message::Text(ack.to_string().into())).await;
                    } else {
                        // Not a connect message — fall through to normal processing
                        first_msg_fallback = Some(text.to_string());
                    }
                } else {
                    // Not parseable as ConnectParams — fall through
                    first_msg_fallback = Some(text.to_string());
                }
            }
            Ok(Message::Close(_)) | Err(_) => return,
            _ => {}
        }
    }

    // `resolve_session_cwd` does synchronous `std::fs::canonicalize` on the
    // client-supplied cwd. The default workspace and the allowlist are
    // already canonical (Config::load_or_init resolves them at config load),
    // so the only blocking syscall is the one for the requested path. Run
    // the call on the blocking pool so the async Tokio runtime thread is
    // never stalled on that single realpath() (slow disk or network FS
    // could otherwise pin a worker).
    let session_cwd = match tokio::task::spawn_blocking({
        let requested = requested_cwd.clone();
        let data_dir = config.data_dir.clone();
        let allowed = config.gateway.allowed_session_cwds.clone();
        move || resolve_session_cwd(requested.as_deref(), &data_dir, &allowed)
    })
    .await
    .unwrap_or_else(|join_err| {
        Err(anyhow::Error::msg(format!(
            "ws session cwd resolution task panicked: {join_err}"
        )))
    }) {
        Ok(cwd) => cwd,
        Err(e) => {
            let err = serde_json::json!({
                "type": "error",
                "message": e.to_string(),
                "code": "INVALID_CWD"
            });
            let _ = sender.send(Message::Text(err.to_string().into())).await;
            return;
        }
    };

    if let Some(err) = needs_onboarding_ws_error(&config) {
        let _ = sender.send(Message::Text(err.to_string().into())).await;
        return;
    }

    // Build a persistent Agent for this connection so history is maintained
    // across turns. The session cwd becomes the security sandbox root; config
    // workspace remains the daemon data directory. Routes through the
    // backchannel constructor so this WS session shares its tool-approval
    // path with the operator-driven dashboard. The agent_alias was
    // validated up-front in handle_ws_chat against the configured agents.
    let mut agent =
        match zeroclaw_runtime::agent::Agent::from_config_with_session_cwd_and_mcp_backchannel(
            &config,
            &agent_alias,
            Some(&session_cwd),
            true,
        )
        .await
        {
            Ok(a) => a,
            Err(e) => {
                ::zeroclaw_log::record!(
                    ERROR,
                    ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Fail)
                        .with_outcome(::zeroclaw_log::EventOutcome::Failure)
                        .with_attrs(::serde_json::json!({"error": format!("{}", e)})),
                    "Agent initialization failed"
                );
                let err = serde_json::json!({
                    "type": "error",
                    "message": format!("Failed to initialise agent: {e}"),
                    "code": "AGENT_INIT_FAILED"
                });
                let _ = sender.send(Message::Text(err.to_string().into())).await;
                let _ = sender
                    .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                        code: 1011,
                        reason: axum::extract::ws::Utf8Bytes::from_static(
                            "Agent initialization failed",
                        ),
                    })))
                    .await;
                return;
            }
        };
    agent.set_memory_session_id(Some(memory_session_id));
    if !stored_messages.is_empty() {
        agent.seed_history(&stored_messages);
    }

    // ── Character card injection ─────────────────────────────────────
    let memory_context = if let Some(char_name) = character_name.clone() {
        let data_dir = config.data_dir.clone();
        let conv_text = stored_messages
            .iter()
            .map(|m| format!("{}: {}", m.role, m.content))
            .collect::<Vec<_>>()
            .join("\n");
        tokio::task::spawn_blocking(move || {
            let mem_store =
                zeroclaw_memory_sigil::ChatMemoryStore::new(&data_dir.join("chat_memory"));
            mem_store.inject_memories_into_prompt(&char_name, &conv_text)
        })
        .await
        .unwrap_or_default()
    } else {
        String::new()
    };

    // Companion persona extracted from the character card's
    // extensions.companion. Falls back to Default (Nurturing) when
    // the card doesn't declare one — the affect module is always on.
    // Resolved system prompt (card + tools + injected lorebook + memory) for
    // the context inspector. Captured here (assembled once per session) and
    // pushed to the client as a context_meta frame below.
    let mut resolved_system_prompt: Option<String> = None;
    let companion_persona: zeroclaw_affect::CompanionPersona =
        if let Some(ref char_name) = character_name {
            match inject_character_card(
                &mut agent,
                char_name,
                character_mode.as_deref(),
                user_name.as_deref(),
                user_description.as_deref(),
                &memory_context,
            ) {
                Ok((Some(first_mes), companion, full_prompt)) => {
                    resolved_system_prompt = Some(full_prompt);
                    // Only greet on a brand-new session. On a resumed session
                    // (stable client session_id) re-sending first_mes would
                    // replay the opening line as a fresh bot turn on every
                    // reconnect — noise once the conversation is underway.
                    if !resumed {
                        let chunk = serde_json::json!({
                            "type": "chunk",
                            "content": first_mes,
                        });
                        let _ = sender.send(Message::Text(chunk.to_string().into())).await;
                        let done = serde_json::json!({
                            "type": "done",
                            "full_response": first_mes,
                        });
                        let _ = sender.send(Message::Text(done.to_string().into())).await;
                    }
                    companion.unwrap_or_default()
                }
                Ok((None, companion, full_prompt)) => {
                    resolved_system_prompt = Some(full_prompt);
                    companion.unwrap_or_default()
                }
                Err(e) => {
                    ::zeroclaw_log::record!(
                        WARN,
                        ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                            .with_outcome(::zeroclaw_log::EventOutcome::Unknown)
                            .with_attrs(::serde_json::json!({
                                "character": char_name, "error": e.to_string()
                            })),
                        "Failed to load character card (continuing without persona)"
                    );
                    zeroclaw_affect::CompanionPersona::default()
                }
            }
        } else {
            zeroclaw_affect::CompanionPersona::default()
        };

    // ── Context inspector: push the resolved system prompt once ─────
    // Additive frame (pre-inspector clients ignore unknown types). The prompt
    // is assembled per session; per-turn context (recalled memories, tokens)
    // rides the done frame instead.
    if let Some(system_prompt) = resolved_system_prompt {
        let context_meta = serde_json::json!({
            "type": "context_meta",
            "system_prompt": system_prompt,
        });
        let _ = sender
            .send(Message::Text(context_meta.to_string().into()))
            .await;
    }

    // ── Tool-approval back-channel ─────────────────────────────────
    // Connection-level event channel that the WsApprovalChannel shares
    // with the per-turn forward task: it pushes ApprovalRequest frames
    // here when the agent's tool loop pauses for consent, and the
    // forward task drains them out the same WebSocket as the regular
    // streaming events. The pending map is shared with the receive loop
    // so inbound `approval_response` frames can resolve the matching
    // oneshot waiter.
    let (approval_event_tx, mut approval_event_rx) =
        tokio::sync::mpsc::channel::<zeroclaw_api::agent::TurnEvent>(8);
    let pending_approvals: PendingApprovals = new_pending_approvals();
    let approval_channel = Arc::new(WsApprovalChannel::new(
        approval_event_tx.clone(),
        pending_approvals.clone(),
        Duration::from_secs(WS_APPROVAL_TIMEOUT_SECS),
    ));
    // Memory save helper for character chats (offloaded to blocking thread)
    let mem_data_dir = config.data_dir.clone();
    let save_user_memory = |content: &str, char_name: &str, user_name: &str| {
        let mem_data_dir = mem_data_dir.clone();
        let content = content.to_string();
        let char_name = char_name.to_string();
        let user_name = user_name.to_string();
        tokio::task::spawn_blocking(move || {
            let mem_store = zeroclaw_memory_sigil::ChatMemoryStore::new(
                &std::path::PathBuf::from(&mem_data_dir).join("chat_memory"),
            );
            let _ = mem_store.save_chat_memory(&char_name, &user_name, "user", &content);
        });
    };

    agent
        .channel_handles()
        .register_channel("ws", approval_channel.clone());

    // Process the first message if it was not a connect frame
    if let Some(ref text) = first_msg_fallback {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(text) {
            if parsed["type"].as_str() == Some("message") {
                let content = parsed["content"].as_str().unwrap_or("").to_string();
                let is_alternate = parsed["alternate"].as_bool().unwrap_or(false);
                if !content.is_empty() {
                    let ws_ids = parse_turn_node_ids(&parsed);
                    // Same content/id ceiling the main receive loop enforces — an
                    // oversized or self-colliding first frame must not slip past.
                    if let Some(err) = validate_message_frame(&content, &ws_ids) {
                        let _ = sender.send(Message::Text(err.to_string().into())).await;
                        return;
                    }
                    let _session_guard = match state.session_queue.acquire(&session_key).await {
                        Ok(guard) => guard,
                        Err(e) => {
                            let err = serde_json::json!({
                                "type": "error",
                                "message": e.to_string(),
                                "code": session_queue_ws_error_code(&e)
                            });
                            let _ = sender.send(Message::Text(err.to_string().into())).await;
                            return;
                        }
                    };
                    process_chat_message(
                        &state,
                        &mut agent,
                        &mut sender,
                        &mut receiver,
                        &mut approval_event_rx,
                        &pending_approvals,
                        &ws_memory,
                        &agent_alias,
                        &companion_persona,
                        &content,
                        &session_key,
                        character_name.clone(),
                        user_name.clone(),
                        parse_turn_node_ids(&parsed),
                        is_alternate,
                    )
                    .await;
                    if !is_alternate && let Some(ref cn) = character_name {
                        save_user_memory(&content, cn, user_name.as_deref().unwrap_or("User"));
                    }
                }
            } else {
                let unknown_type = parsed["type"].as_str().unwrap_or("unknown");
                let err = serde_json::json!({
                    "type": "error",
                    "message": format!(
                        "Unsupported message type \"{unknown_type}\". Send {{\"type\":\"message\",\"content\":\"your text\"}}"
                    )
                });
                let _ = sender.send(Message::Text(err.to_string().into())).await;
            }
        } else {
            let err = serde_json::json!({
                "type": "error",
                "message": "Invalid JSON. Send {\"type\":\"message\",\"content\":\"your text\"}"
            });
            let _ = sender.send(Message::Text(err.to_string().into())).await;
        }
    }

    // Subscribe to the shared broadcast channel so cron/heartbeat events
    // are forwarded to this WebSocket client.
    let mut broadcast_rx = state.event_tx.subscribe();

    loop {
        tokio::select! {
            // ── Client message ────────────────────────────────────────
            client_msg = receiver.next() => {
                let Some(msg) = client_msg else { break };
                let msg = match msg {
                    Ok(Message::Text(text)) => text,
                    Ok(Message::Close(_)) | Err(_) => break,
                    _ => continue,
                };

                // Parse incoming message
                let parsed: serde_json::Value = match serde_json::from_str(&msg) {
                    Ok(v) => v,
                    Err(e) => {
                        let err = serde_json::json!({
                            "type": "error",
                            "message": format!("Invalid JSON: {}", e),
                            "code": "INVALID_JSON"
                        });
                        let _ = sender.send(Message::Text(err.to_string().into())).await;
                        continue;
                    }
                };

                let msg_type = parsed["type"].as_str().unwrap_or("");

                // ── Voice duplex event dispatch (gated by feature flag + runtime config) ──
                #[cfg(feature = "gateway-voice-duplex")]
                {
                    // Multi-instance shape: presence in the map = enabled.
                    let duplex_enabled = !state.config.read().channels.voice_duplex.is_empty();
                    if duplex_enabled {
                        if let Some(voice_event) = crate::voice_duplex::try_parse_voice_event(&msg) {
                            if let Some(error_frame) = crate::voice_duplex::handle_voice_event(voice_event) {
                                let _ = sender.send(Message::Text(error_frame.to_string().into())).await;
                            }
                            continue;
                        }
                    }
                }

                // ── approval_response (operator answered a tool prompt) ──
                if msg_type == "approval_response" {
                    let request_id = parsed["request_id"].as_str().unwrap_or("");
                    let decision_str = parsed["decision"].as_str().unwrap_or("");
                    let decision = match decision_str {
                        "approve" => Some(ChannelApprovalResponse::Approve),
                        "always" => Some(ChannelApprovalResponse::AlwaysApprove),
                        "deny" => Some(ChannelApprovalResponse::Deny),
                        _ => None,
                    };
                    if request_id.is_empty() || decision.is_none() {
                        let err = serde_json::json!({
                            "type": "error",
                            "message": "approval_response requires request_id and decision in {approve,deny,always}",
                            "code": "INVALID_APPROVAL_RESPONSE"
                        });
                        let _ = sender.send(Message::Text(err.to_string().into())).await;
                        continue;
                    }
                    if let Some(tx) = pending_approvals.lock().remove(request_id) {
                        let _ = tx.send(decision.expect("checked above"));
                    } else {
                        ::zeroclaw_log::record!(DEBUG, ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note).with_attrs(::serde_json::json!({"request_id": request_id})), "approval_response with no matching pending request");
                    }
                    continue;
                }

                // ── select_leaf (switch the active branch; zero generation) ──
                // Swipe/branch navigation: the client picks which leaf is the
                // active path. No model call — just record the selection so the
                // next resume seeds that branch. (Solution B Phase 2.)
                if msg_type == "select_leaf" {
                    let leaf_id = parsed["leaf_id"].as_str().unwrap_or("");
                    if leaf_id.is_empty() {
                        let err = serde_json::json!({
                            "type": "error",
                            "message": "select_leaf requires leaf_id",
                            "code": "INVALID_SELECT_LEAF"
                        });
                        let _ = sender.send(Message::Text(err.to_string().into())).await;
                        continue;
                    }
                    if let Some(ref backend) = state.session_backend {
                        // Serialize this mutation against an in-flight turn on the
                        // same session (another client's socket may be mid-persist).
                        // Best-effort: if the queue is saturated, fall through
                        // unguarded rather than surface a spurious error on a
                        // zero-generation op.
                        let _guard = state.session_queue.acquire(&session_key).await.ok();
                        // Validate membership before recording — set_active_leaf
                        // is a blind UPSERT, and a dangling active_leaf would
                        // orphan history on the next turn (see conversation_tip).
                        if !backend.node_exists(&session_key, leaf_id) {
                            let err = serde_json::json!({
                                "type": "error",
                                "message": "select_leaf: unknown leaf_id (not a node in this conversation)",
                                "code": "INVALID_SELECT_LEAF"
                            });
                            let _ = sender.send(Message::Text(err.to_string().into())).await;
                            continue;
                        }
                        let _ = backend.set_active_leaf(&session_key, leaf_id);
                    }
                    let ack = serde_json::json!({ "type": "active_leaf", "active_leaf": leaf_id });
                    let _ = sender.send(Message::Text(ack.to_string().into())).await;
                    continue;
                }

                // ── edit (in-place content change; SillyTavern semantics) ──
                // Same node id/role/parent — only the text changes. Broadcast so
                // every client on this session re-renders the node. Keyed on the
                // BARE session_id (matches event_matches_session).
                if msg_type == "edit" {
                    let msg_id = parsed["msg_id"].as_str().unwrap_or("");
                    let new_content = parsed["content"].as_str().unwrap_or("");
                    // Reject empty content too — an edit that clears text would
                    // silently wipe a node; treat it as malformed, not a wipe.
                    if msg_id.is_empty() || new_content.is_empty() {
                        let err = serde_json::json!({
                            "type": "error",
                            "message": "edit requires a non-empty msg_id and content",
                            "code": "INVALID_EDIT"
                        });
                        let _ = sender.send(Message::Text(err.to_string().into())).await;
                        continue;
                    }
                    if let Some(ref backend) = state.session_backend {
                        // Serialize against an in-flight turn (see select_leaf).
                        let _guard = state.session_queue.acquire(&session_key).await.ok();
                        if !apply_edit(backend.as_ref(), &session_key, msg_id, new_content) {
                            let err = serde_json::json!({
                                "type": "error",
                                "message": "edit: unknown msg_id",
                                "code": "INVALID_EDIT"
                            });
                            let _ = sender.send(Message::Text(err.to_string().into())).await;
                            continue;
                        }
                        let _ = state.event_tx.send(serde_json::json!({
                            "type": "node_edited",
                            "session_id": session_id,
                            "msg_id": msg_id,
                            "content": new_content
                        }));
                    }
                    continue;
                }

                // ── delete (remove a node and its entire subtree) ──
                if msg_type == "delete" {
                    let msg_id = parsed["msg_id"].as_str().unwrap_or("");
                    if msg_id.is_empty() {
                        let err = serde_json::json!({
                            "type": "error",
                            "message": "delete requires a msg_id",
                            "code": "INVALID_DELETE"
                        });
                        let _ = sender.send(Message::Text(err.to_string().into())).await;
                        continue;
                    }
                    if let Some(ref backend) = state.session_backend {
                        // Serialize against an in-flight turn (see select_leaf).
                        let _guard = state.session_queue.acquire(&session_key).await.ok();
                        let removed = apply_delete(backend.as_ref(), &session_key, msg_id);
                        if removed.is_empty() {
                            let err = serde_json::json!({
                                "type": "error",
                                "message": "delete: unknown msg_id",
                                "code": "INVALID_DELETE"
                            });
                            let _ = sender.send(Message::Text(err.to_string().into())).await;
                            continue;
                        }
                        let _ = state.event_tx.send(serde_json::json!({
                            "type": "node_deleted",
                            "session_id": session_id,
                            "msg_id": msg_id,
                            "removed": removed
                        }));
                    }
                    continue;
                }

                if msg_type != "message" {
                    let err = serde_json::json!({
                        "type": "error",
                        "message": format!(
                            "Unsupported message type \"{msg_type}\". Send {{\"type\":\"message\",\"content\":\"your text\"}}"
                        ),
                        "code": "UNKNOWN_MESSAGE_TYPE"
                    });
                    let _ = sender.send(Message::Text(err.to_string().into())).await;
                    continue;
                }

                let content = parsed["content"].as_str().unwrap_or("").to_string();
                if content.is_empty() {
                    let err = serde_json::json!({
                        "type": "error",
                        "message": "Message content cannot be empty",
                        "code": "EMPTY_CONTENT"
                    });
                    let _ = sender.send(Message::Text(err.to_string().into())).await;
                    continue;
                }
                if let Some((established, incoming)) =
                    detect_character_conflict(&parsed, &character_name)
                {
                    let err = serde_json::json!({
                        "type": "error",
                        "message": format!(
                            "Cannot switch character from '{established}' to '{incoming}' mid-session; reconnect to change characters"
                        ),
                        "code": "CHARACTER_CONTEXT_CONFLICT"
                    });
                    let _ = sender.send(Message::Text(err.to_string().into())).await;
                    continue;
                }
                let ws_ids = parse_turn_node_ids(&parsed);
                // An alternate turn (regenerate/swipe) still generates + persists
                // a sibling, but must NOT feed memory — it's a re-roll of the same
                // exchange, not new lived context. Default false => normal turn.
                let is_alternate = parsed["alternate"].as_bool().unwrap_or(false);
                // Cap content + client-minted ids before they become persisted
                // tree nodes (replayed in every history_snapshot). Shared with the
                // first-frame `message` path so neither WS entry point bypasses it.
                if let Some(err) = validate_message_frame(&content, &ws_ids) {
                    let _ = sender.send(Message::Text(err.to_string().into())).await;
                    continue;
                }

                // Acquire session lock to serialize concurrent turns
                let _session_guard = match state.session_queue.acquire(&session_key).await {
                    Ok(guard) => guard,
                    Err(e) => {
                        let err = serde_json::json!({
                            "type": "error",
                            "message": e.to_string(),
                            "code": session_queue_ws_error_code(&e)
                        });
                        let _ = sender.send(Message::Text(err.to_string().into())).await;
                        continue;
                    }
                };

                process_chat_message(
                    &state,
                    &mut agent,
                    &mut sender,
                    &mut receiver,
                    &mut approval_event_rx,
                    &pending_approvals,
                    &ws_memory,
                    &agent_alias,
                    &companion_persona,
                    &content,
                    &session_key,
                    character_name.clone(),
                    user_name.clone(),
                    parse_turn_node_ids(&parsed),
                    is_alternate,
                )
                .await;
                if !is_alternate && let Some(ref cn) = character_name {
                    save_user_memory(&content, cn, user_name.as_deref().unwrap_or("User"));
                }
            }

            // ── Broadcast event (cron/heartbeat results) ──────────────
            event = broadcast_rx.recv() => {
                if let Ok(event) = event
                    && event_matches_session(&event, &session_id)
                {
                    let _ = sender.send(Message::Text(event.to_string().into())).await;
                }
            }

            // ── Approval request from the agent's tool loop ────────────
            // The WsApprovalChannel emits these whenever a supervised tool
            // call needs operator consent. Forwarded out the same socket
            // as the regular streaming events; the matching response
            // arrives via the `approval_response` arm above and resolves
            // the channel's pending oneshot.
            approval_event = approval_event_rx.recv() => {
                let Some(event) = approval_event else { break };
                let frame = match event {
                    zeroclaw_api::agent::TurnEvent::ApprovalRequest {
                        request_id,
                        tool_name,
                        arguments_summary,
                        timeout_secs,
                    } => serde_json::json!({
                        "type": "approval_request",
                        "request_id": request_id,
                        "tool": tool_name,
                        "arguments_summary": arguments_summary,
                        "timeout_secs": timeout_secs,
                    }),
                    other => {
                        ::zeroclaw_log::record!(WARN, ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note).with_outcome(::zeroclaw_log::EventOutcome::Unknown).with_attrs(::serde_json::json!({"kind": format!("{:?}", other)})), "non-ApprovalRequest event leaked into approval channel");
                        continue;
                    }
                };
                let _ = sender.send(Message::Text(frame.to_string().into())).await;
            }
        }
    }
}

fn resolve_session_cwd(
    requested_cwd: Option<&str>,
    default_workspace: &Path,
    allowed_session_cwds: &[PathBuf],
) -> anyhow::Result<PathBuf> {
    // No client-supplied cwd → use the gateway's own data_dir. The allowlist
    // only constrains what a paired client can request. `default_workspace` is
    // already canonical (Config::load_or_init resolves it once at startup).
    let Some(raw) = requested_cwd else {
        return Ok(default_workspace.to_path_buf());
    };

    let canonical = std::fs::canonicalize(raw).map_err(|e| {
        ::zeroclaw_log::record!(
            WARN,
            ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Reject)
                .with_outcome(::zeroclaw_log::EventOutcome::Failure)
                .with_attrs(::serde_json::json!({
                    "cwd": raw,
                    "error": format!("{}", e),
                })),
            "ws session cwd canonicalize failed"
        );
        anyhow::Error::msg(format!("cwd is not a usable directory ({raw}): {e}"))
    })?;

    if !cwd_in_allowlist(&canonical, allowed_session_cwds) {
        ::zeroclaw_log::record!(
            WARN,
            ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Reject)
                .with_outcome(::zeroclaw_log::EventOutcome::Failure)
                .with_attrs(::serde_json::json!({
                    "cwd": canonical.display().to_string(),
                    "allowed_session_cwds": allowed_session_cwds,
                })),
            "ws session cwd denied (not in allowlist)"
        );
        return Err(anyhow::Error::msg(format!(
            "cwd `{}` is not in gateway.allowed_session_cwds; add the directory to \
             [gateway].allowed_session_cwds in config.toml, or omit the cwd query \
             parameter to fall back to the gateway default workspace",
            canonical.display()
        )));
    }

    Ok(canonical)
}

/// Component-wise prefix check (`Path::starts_with` matches on path
/// components, not raw string prefixes — so `/foo/barbaz` does not match
/// an allowlist entry of `/foo/bar`). Both the requested cwd and the
/// allowlist entries are canonicalized at config load (allowlist) or on
/// the blocking pool (requested cwd) — no canonicalize happens here.
fn cwd_in_allowlist(canonical_cwd: &Path, allowed: &[PathBuf]) -> bool {
    allowed
        .iter()
        .any(|allowed_root| canonical_cwd.starts_with(allowed_root))
}

fn session_queue_ws_error_code(error: &crate::session_queue::SessionQueueError) -> &'static str {
    match error {
        crate::session_queue::SessionQueueError::QueueFull { .. } => "SESSION_QUEUE_FULL",
        crate::session_queue::SessionQueueError::Timeout { .. } => "SESSION_QUEUE_TIMEOUT",
    }
}

/// Persist a turn's new messages as conversation-tree nodes, chained under the
/// session's current tip (`conversation_tip`) so a new turn extends the active
/// branch — and, crucially, extends a legacy purely-linear session's tail
/// instead of orphaning it behind a second root. The final assistant node
/// carries `status`; if the turn produced no assistant message (e.g. cancelled
/// before any output) and `fallback_assistant` is provided, a synthetic
/// assistant node with that content is appended so the interrupted turn stays
/// visible and resumable. Sets the active leaf to the last node. Returns that
/// leaf id, or `None` if nothing was persisted.
///
/// Ids are minted server-side here; once the client sends stable msg_ids
/// (Solution B Phase 2) they replace the minted ones to drive branching.
/// Client-supplied node identity for a turn (Solution B Phase 2). When the
/// client mints stable ids they drive the tree; when absent (pre-P2 clients)
/// they are minted server-side, preserving Phase-1 behavior.
#[derive(Default, Clone)]
struct TurnNodeIds {
    /// Parent to attach the turn under; falls back to `conversation_tip`.
    parent_id: Option<String>,
    /// Id for the user node.
    user_msg_id: Option<String>,
    /// Id for the (final) assistant node — also the streaming `node_id`.
    assistant_msg_id: Option<String>,
}

/// Pull client-minted node ids off a `message` frame. All optional — a pre-P2
/// client sends none and the server mints them (Phase-1 behavior preserved).
fn parse_turn_node_ids(parsed: &serde_json::Value) -> TurnNodeIds {
    let s = |k: &str| parsed[k].as_str().map(str::to_string);
    TurnNodeIds {
        parent_id: s("parent_id"),
        user_msg_id: s("msg_id"),
        assistant_msg_id: s("assistant_msg_id"),
    }
}

fn detect_character_conflict(
    parsed: &serde_json::Value,
    session_character: &Option<String>,
) -> Option<(String, String)> {
    let incoming = parsed["character_name"]
        .as_str()
        .filter(|s| !s.is_empty())?;
    let established = session_character.as_ref()?;
    if incoming != established.as_str() {
        Some((established.clone(), incoming.to_string()))
    } else {
        None
    }
}

/// Reject a client `message` frame whose content or node ids would poison the
/// persisted tree. The REST path is bounded by `RequestBodyLimitLayer(MAX_BODY_SIZE)`;
/// WS frames bypass that layer, so BOTH WS `message` entry points — the
/// first-frame fallback and the main receive loop — funnel through this one
/// helper to enforce the same ceiling. Returns the error frame to send back on
/// rejection, or `None` when the frame is safe.
fn validate_message_frame(content: &str, ids: &TurnNodeIds) -> Option<serde_json::Value> {
    // Ids are short client uuids — a generous 256-char cap rejects abuse without
    // ever tripping a legitimate client.
    const MAX_NODE_ID_LEN: usize = 256;
    let id_too_long = [&ids.parent_id, &ids.user_msg_id, &ids.assistant_msg_id]
        .iter()
        .any(|o| o.as_deref().is_some_and(|s| s.len() > MAX_NODE_ID_LEN));
    if content.len() > crate::MAX_BODY_SIZE || id_too_long {
        return Some(serde_json::json!({
            "type": "error",
            "message": "Message exceeds the maximum size",
            "code": "CONTENT_TOO_LARGE"
        }));
    }
    // A turn's user and assistant nodes are distinct rows; the same id for both
    // collides on the UNIQUE(session_key, msg_id) index and the reply is dropped.
    if let (Some(u), Some(a)) = (ids.user_msg_id.as_deref(), ids.assistant_msg_id.as_deref())
        && u == a
    {
        return Some(serde_json::json!({
            "type": "error",
            "message": "user_msg_id and assistant_msg_id must differ"
        }));
    }
    None
}

/// Persist one conversation turn as exactly TWO tree nodes — the user node and
/// the assistant node — under the session's validated tip (or the client's
/// validated parent_id). Returns the assistant node id (the new active leaf).
///
/// Deliberately persists `user_content` (the RAW user input) — NOT the agent's
/// view of the turn, which carries the ephemeral recall/affect/timestamp prefix
/// (`content_owned`) that must never surface as the user's own words. And it
/// persists only the user + final assistant, NOT the turn's intermediate
/// messages (tool calls / XML "[Tool results]" pseudo-user messages), which are
/// turn-internal, not conversation nodes — persisting them produced phantom
/// bubbles and dangling branches in the client tree.
fn persist_turn_as_nodes(
    backend: &dyn zeroclaw_infra::session_backend::SessionBackend,
    session_key: &str,
    user_content: &str,
    assistant_content: &str,
    status: &str,
    ids: &TurnNodeIds,
) -> Option<String> {
    use zeroclaw_infra::session_backend::ConversationNode;

    let mint = || uuid::Uuid::new_v4().to_string();
    let log_err = |which: &str, msg_id: &str, e: std::io::Error| {
        ::zeroclaw_log::record!(
            WARN,
            ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                .with_outcome(::zeroclaw_log::EventOutcome::Failure)
                .with_attrs(::serde_json::json!({
                    "session_key": session_key, "which": which, "msg_id": msg_id, "error": e.to_string(),
                })),
            "append_node failed while persisting turn node"
        );
    };

    // Attach under the client-chosen parent ONLY if it exists in the tree;
    // a bogus/dangling parent would orphan history on resume (mirror the read
    // side's guard), so fall back to the validated tip.
    let parent = match ids.parent_id.as_deref() {
        Some(p) if backend.node_exists(session_key, p) => Some(p.to_string()),
        _ => backend.conversation_tip(session_key),
    };

    // User node (raw content). A UNIQUE conflict here means the client re-sent
    // an existing id (retry) — the node is already present with the same user
    // text, so we log and still chain the assistant under it (no data loss).
    let mut user_id = ids.user_msg_id.clone().unwrap_or_else(mint);
    let user_node = ConversationNode {
        msg_id: user_id.clone(),
        parent_id: parent.clone(),
        role: "user".to_string(),
        content: user_content.to_string(),
        author_id: None,
        status: None,
        meta: None,
        created_at: None,
    };
    if let Err(e) = backend.append_node(session_key, &user_node) {
        log_err("user", &user_id, e);
        // Resolve who actually owns this id before chaining the assistant under
        // it. Look up the existing node's role in the tree:
        //   - absent  → a REAL write failure; chaining would dangle the parent
        //     and orphan ALL prior history on resume (flatten_active_path breaks
        //     at the missing node). Bail.
        //   - role == "user" → benign id reuse (retry); chain under it.
        //   - role != "user" → a different node already owns this id; chaining
        //     would graft the assistant onto the wrong node. Mint a fresh user
        //     id, append it under the resolved parent, and chain under that.
        let existing_role = backend
            .load_tree(session_key)
            .into_iter()
            .find(|n| n.msg_id == user_id)
            .map(|n| n.role);
        match existing_role.as_deref() {
            None => return None,
            Some("user") => {}
            Some(_) => {
                let fresh = mint();
                let fresh_user = ConversationNode {
                    msg_id: fresh.clone(),
                    parent_id: parent.clone(),
                    role: "user".to_string(),
                    content: user_content.to_string(),
                    author_id: None,
                    status: None,
                    meta: None,
                    created_at: None,
                };
                if let Err(e2) = backend.append_node(session_key, &fresh_user) {
                    log_err("user", &fresh, e2);
                    return None;
                }
                user_id = fresh;
            }
        }
    }

    // Assistant node, chained under the user node.
    let mut assistant_id = ids.assistant_msg_id.clone().unwrap_or_else(mint);
    let mut assistant_node = ConversationNode {
        msg_id: assistant_id.clone(),
        parent_id: Some(user_id),
        role: "assistant".to_string(),
        content: assistant_content.to_string(),
        author_id: None,
        status: Some(status.to_string()),
        meta: None,
        created_at: None,
    };
    if let Err(e) = backend.append_node(session_key, &assistant_node) {
        log_err("assistant", &assistant_id, e);
        // Resolve who owns this id before writing, mirroring the user-node guard:
        //   - role == "assistant" → benign reuse (regenerate/retry of THIS turn);
        //     UPDATE the node with the fresh content+status, never drop the reply.
        //   - role != "assistant" → the id collides with an unrelated node; an
        //     unconditional update_node would flip that node's role to "assistant"
        //     and clobber its content (parent_id is never rewritten) → tree
        //     corruption. Mint a fresh id and append instead.
        //   - absent → a REAL write failure; re-mint and re-append.
        // Bail only if even the fresh append fails (reply genuinely unpersistable).
        let existing_role = backend
            .load_tree(session_key)
            .into_iter()
            .find(|n| n.msg_id == assistant_id)
            .map(|n| n.role);
        if existing_role.as_deref() == Some("assistant") {
            let _ = backend.update_node(session_key, &assistant_node);
        } else {
            let fresh = mint();
            assistant_node.msg_id = fresh.clone();
            if let Err(e2) = backend.append_node(session_key, &assistant_node) {
                log_err("assistant", &fresh, e2);
                return None;
            }
            assistant_id = fresh;
        }
    }

    let _ = backend.set_active_leaf(session_key, &assistant_id);
    Some(assistant_id)
}

/// Edit a node's content IN-PLACE (SillyTavern semantics) — same id, role,
/// parent, status, meta, author, created_at; only the text changes. NOT a new
/// branch. Returns false (no write) if the node is absent. Drives the `edit`
/// WS frame. Relies on Inc 3a's update_node legacy `lin-*` rowid fallback so a
/// pre-tree linear node is editable too.
fn apply_edit(
    backend: &dyn zeroclaw_infra::session_backend::SessionBackend,
    session_key: &str,
    msg_id: &str,
    new_content: &str,
) -> bool {
    let Some(existing) = backend
        .load_tree(session_key)
        .into_iter()
        .find(|n| n.msg_id == msg_id)
    else {
        return false;
    };
    let updated = zeroclaw_infra::session_backend::ConversationNode {
        content: new_content.to_string(),
        ..existing
    };
    backend.update_node(session_key, &updated).unwrap_or(false)
}

/// Delete a node and its entire subtree; returns the removed `msg_id`s (empty
/// — no write — if the node is absent). If the active leaf fell inside the
/// removed subtree, reset it to the deleted node's parent (when that parent
/// still exists) so the next turn extends a live branch instead of a dangling
/// leaf. There is no clear-active-leaf method by design — if no valid parent
/// remains, the active leaf is left as-is and the read side filters the unknown
/// reference. Drives the `delete` WS frame; relies on Inc 3a's delete_subtree
/// legacy `lin-*` rowid fallback.
fn apply_delete(
    backend: &dyn zeroclaw_infra::session_backend::SessionBackend,
    session_key: &str,
    msg_id: &str,
) -> Vec<String> {
    // Capture the target's parent BEFORE deleting (the row is gone afterward).
    let Some(parent) = backend
        .load_tree(session_key)
        .into_iter()
        .find(|n| n.msg_id == msg_id)
        .map(|n| n.parent_id)
    else {
        return Vec::new();
    };
    let removed = backend
        .delete_subtree(session_key, msg_id)
        .unwrap_or_default();
    if let Some(leaf) = backend.get_active_leaf(session_key)
        && removed.contains(&leaf)
        && let Some(parent_id) = parent
        && backend.node_exists(session_key, &parent_id)
    {
        let _ = backend.set_active_leaf(session_key, &parent_id);
    }
    removed
}

/// Load a character card and inject it into the agent's system prompt.
/// Also injects relevant memories from past conversations.
/// Returns `Ok(Some(first_mes))` if the card has an opening message,
/// plus the companion persona extracted from extensions.companion (if any).
fn build_character_prompt_components(
    character_name: &str,
    mode: Option<&str>,
    user_name: Option<&str>,
    user_description: Option<&str>,
    memory_context: &str,
) -> anyhow::Result<(
    String,
    Option<String>,
    Option<zeroclaw_affect::CompanionPersona>,
)> {
    let mgr = zeroclaw_cards::CardManager::default()?;
    let card = mgr
        .load(character_name)
        .map_err(|e| anyhow::Error::msg(format!("{e}")))?;

    let companion = parse_companion_from_extensions(&card.data.extensions, &card.data.name);

    let uname = user_name.unwrap_or("User");
    let char_mode = mode.unwrap_or("play");
    let fragments = card.build_prompt(
        char_mode,
        uname,
        "",
        user_description.filter(|d| !d.is_empty()),
    );

    let card_prompt = fragments
        .iter()
        .map(|f| f.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");

    let image_contract = image_consistency_instructions(&card.data.extensions);

    let tool_instructions = format!(
        "\n\n## Tool Usage\n\nYou have access to image generation and voice tools. Use them naturally during conversation:\n\
         - For photos, call `xai_image_gen` with a clear English prompt that includes enough scene detail\n\
         - For voice messages, call `xai_tts` with the spoken text\n\
         - Do NOT mention that you are using tools — the user sees only the generated image or hears the audio\n\
         - Generate images to enhance the scene and atmosphere naturally\n\
         - If this character has explicit image consistency requirements, always keep those rules in the prompt"
    );
    let tool_instructions = if image_contract.is_empty() {
        tool_instructions
    } else {
        format!("{tool_instructions}\n\n{image_contract}")
    };

    let mut full_prompt = format!("{card_prompt}{tool_instructions}");
    if !memory_context.is_empty() {
        full_prompt = format!("{full_prompt}\n\n{memory_context}");
    }

    let first_mes = if card.data.first_mes.is_empty() {
        None
    } else {
        let rendered = card
            .data
            .first_mes
            .replace("{{char}}", &card.data.name)
            .replace("{{user}}", uname);
        Some(rendered)
    };

    Ok((full_prompt, first_mes, companion))
}

fn inject_character_card(
    agent: &mut zeroclaw_runtime::agent::Agent,
    character_name: &str,
    mode: Option<&str>,
    user_name: Option<&str>,
    user_description: Option<&str>,
    memory_context: &str,
) -> anyhow::Result<(
    Option<String>,
    Option<zeroclaw_affect::CompanionPersona>,
    String,
)> {
    let (full_prompt, first_mes, companion) = build_character_prompt_components(
        character_name,
        mode,
        user_name,
        user_description,
        memory_context,
    )?;
    agent.add_custom_system_section("character_card", full_prompt.clone());
    Ok((first_mes, companion, full_prompt))
}

/// Parse CompanionPersona from character card extensions.companion.
/// Returns None when extensions.companion is absent or malformed —
/// the affect module falls back to CompanionPersona::default().
fn parse_companion_from_extensions(
    extensions: &serde_json::Value,
    character_name: &str,
) -> Option<zeroclaw_affect::CompanionPersona> {
    let companion = extensions.get("companion")?;
    let archetype_str = companion.get("archetype").and_then(|v| v.as_str())?;
    let archetype = match archetype_str {
        "nurturing" => zeroclaw_affect::Archetype::Nurturing,
        "playful" => zeroclaw_affect::Archetype::Playful,
        "steady" => zeroclaw_affect::Archetype::Steady,
        _ => return None,
    };
    let warmth = companion
        .get("base_warmth")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.6) as f32;
    let energy = companion
        .get("base_energy")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.5) as f32;
    Some(zeroclaw_affect::CompanionPersona {
        name: character_name.to_string(),
        archetype,
        base_warmth: warmth,
        base_energy: energy,
    })
}

fn image_consistency_instructions(extensions: &serde_json::Value) -> String {
    let profile = match extensions
        .get("image_profile")
        .or_else(|| extensions.get("imageProfile"))
        .and_then(|p| p.as_object())
    {
        Some(profile) => profile,
        None => return String::new(),
    };

    let identity_prompt = profile
        .get("identity_prompt")
        .or_else(|| profile.get("identityPrompt"))
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty());
    let style_prompt = profile
        .get("style_prompt")
        .or_else(|| profile.get("stylePrompt"))
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty());
    let scene_prefix = profile
        .get("scene_prefix")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty());

    if identity_prompt.is_none() && style_prompt.is_none() && scene_prefix.is_none() {
        return String::new();
    }

    let mut parts: Vec<String> = Vec::new();
    parts.push("- Keep the same physical identity, clothing cues, and body language across all images in this conversation.".to_string());

    if let Some(identity_prompt) = identity_prompt {
        parts.push(format!("- Identity anchor: {identity_prompt}"));
    }
    if let Some(style_prompt) = style_prompt {
        parts.push(format!("- Visual style anchor: {style_prompt}"));
    }
    if let Some(scene_prefix) = scene_prefix {
        parts.push(format!("- Scene continuity anchor: {scene_prefix}"));
    }

    if let Some(negatives) = profile.get("negative_prompt").and_then(|v| v.as_str())
        && !negatives.trim().is_empty()
    {
        parts.push(format!("- Avoid: {negatives}"));
    }

    format!("- [Image consistency rule]\n{}", parts.join("\n"))
}

fn needs_onboarding_ws_error(
    config: &zeroclaw_config::schema::Config,
) -> Option<serde_json::Value> {
    let model = config.resolve_default_model().unwrap_or_default();
    crate::needs_onboarding_for(&model)?;
    Some(serde_json::json!({
        "type": "error",
        "error": "needs_onboarding",
        "code": "NEEDS_ONBOARDING",
        "message": crate::needs_onboarding_channel_reply(),
        "url": "/onboard",
    }))
}

fn event_matches_session(event: &serde_json::Value, session_id: &str) -> bool {
    match event.get("session_id").and_then(|value| value.as_str()) {
        Some(event_session_id) => event_session_id == session_id,
        None => true,
    }
}

/// Perceive the user's affect this turn, returning both the prompt hint the
/// agent sees and the structured state the client renders (avatar mood glow).
///
/// Both are gated on the same confidence floor: below it we return neither,
/// so a flat "ok" neither injects an affect hint nor jitters the glow — the
/// avatar stays at its warm default.
fn compute_affect(
    user_message: &str,
    persona: &zeroclaw_affect::CompanionPersona,
) -> (String, Option<zeroclaw_affect::AffectState>) {
    use chrono::Timelike;
    use zeroclaw_affect::{
        ConversationContext, HeuristicEstimator, UserSignals, perceive_and_appraise,
    };

    let ctx = ConversationContext {
        local_hour: chrono::Local::now().hour() as u8,
        ..Default::default()
    };
    let signals = UserSignals {
        message_text: user_message.to_string(),
        ..Default::default()
    };
    let (affect, stance) = perceive_and_appraise(&HeuristicEstimator, &ctx, &signals, persona);

    if affect.confidence < 0.35 {
        return (String::new(), None);
    }

    (stance.to_prompt_hint(), Some(affect))
}

/// Process a single chat message through the agent and send the response.
///
/// Uses [`Agent::turn_streamed`] so that intermediate text chunks, tool calls,
/// and tool results are forwarded to the WebSocket client in real time.
#[allow(clippy::too_many_arguments)]
async fn process_chat_message(
    state: &AppState,
    agent: &mut zeroclaw_runtime::agent::Agent,
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    receiver: &mut futures_util::stream::SplitStream<WebSocket>,
    approval_event_rx: &mut tokio::sync::mpsc::Receiver<zeroclaw_api::agent::TurnEvent>,
    pending_approvals: &PendingApprovals,
    ws_memory: &Option<Arc<dyn zeroclaw_memory::Memory>>,
    agent_alias: &str,
    companion_persona: &zeroclaw_affect::CompanionPersona,
    content: &str,
    session_key: &str,
    character_name: Option<String>,
    user_name: Option<String>,
    turn_ids: TurnNodeIds,
    is_alternate: bool,
) {
    use futures_util::StreamExt as _;
    use zeroclaw_runtime::agent::TurnEvent;

    let provider_label = state
        .config
        .read()
        .first_model_provider_type()
        .unwrap_or("unknown")
        .to_string();

    // Broadcast agent_start event
    let _ = state.event_tx.send(serde_json::json!({
        "type": "agent_start",
        "model_provider": provider_label,
        "model": state.model,
    }));

    // Set session state to running
    let turn_id = uuid::Uuid::new_v4().to_string();
    if let Some(ref backend) = state.session_backend {
        let _ = backend.set_session_state(session_key, "running", Some(&turn_id));
    }

    // ── Cancellation token lifecycle ─────────────────────────────
    // Create a token before the turn starts so the abort endpoint
    // can cancel it. Remove it after the turn completes regardless
    // of outcome (normal, error, or cancelled).
    let cancel_token = tokio_util::sync::CancellationToken::new();
    {
        state
            .cancel_tokens
            .lock()
            .insert(session_key.to_string(), cancel_token.clone());
    }

    // Channel for streaming turn events from the agent.
    let (event_tx, mut event_rx) = tokio::sync::mpsc::channel::<TurnEvent>(64);
    let (steering_tx, mut steering_rx) = tokio::sync::mpsc::channel::<String>(32);

    // Run the streamed turn concurrently: the agent produces events
    // while we forward them to the WebSocket below.  We cannot move
    // `agent` into a spawned task (it is `&mut`), so we use a join
    // instead — `turn_streamed` writes to the channel and we drain it
    // from the other branch.
    // ── Affect modulation ─────────────────────────────────────────
    // Estimate the user's emotional state from their message, pick an
    // empathy strategy, and prepend a short prompt hint to the content
    // the agent sees. The hint is NOT stored in memory or consolidation
    // — those use the original `content` argument. Only the agent turn
    // sees the hint.
    // ── Per-turn memory recall ────────────────────────────────────
    // Recall driven by THIS message, not the connect-time history. The
    // connect-time injection (memory_context) only fires on resumed sessions
    // and keys off the *previous* last-user message, so a brand-new question
    // would otherwise recall nothing relevant to what was just asked. Same
    // discipline as the affect hint: this is prepended to what the agent sees
    // for the turn and is NOT stored or consolidated (saves use raw `content`).
    let recall_block = if let Some(ref char_name) = character_name {
        let data_dir = state.config.read().data_dir.clone();
        let char_name = char_name.clone();
        let query = format!("User: {content}");
        tokio::task::spawn_blocking(move || {
            let store = zeroclaw_memory_sigil::ChatMemoryStore::new(&data_dir.join("chat_memory"));
            store.inject_memories_into_prompt(&char_name, &query)
        })
        .await
        .unwrap_or_default()
    } else {
        String::new()
    };
    // Snapshot the per-turn injected memories for the context inspector before
    // recall_block is moved into the prompt prefix below.
    let recalled_memories = recall_block.clone();

    let (affect_hint, affect_state) = compute_affect(content, companion_persona);
    let prefix_parts: Vec<String> = [recall_block, affect_hint]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect();
    let content_owned = if prefix_parts.is_empty() {
        content.to_string()
    } else {
        format!("{}\n\n{content}", prefix_parts.join("\n\n"))
    };
    let session_key_owned = session_key.to_string();
    let turn_fut = async {
        zeroclaw_runtime::agent::loop_::scope_session_key(
            Some(session_key_owned),
            agent.turn_streamed_with_steering_state(
                &content_owned,
                event_tx,
                Some(cancel_token.clone()),
                Some(&mut steering_rx),
            ),
        )
        .await
    };

    // Drive both futures concurrently: the agent turn produces events
    // and we relay them over WebSocket. Track streamed chunks so we
    // can reconstruct partial content on cancellation.
    //
    let mut accumulated_text = String::new();

    // Aggregate token usage across all LLM calls in this turn.
    // The agent emits TurnEvent::Usage once per LLM call when the provider
    // surfaces usage; we sum to produce a single done-frame total.
    let mut total_input_tokens: Option<u64> = None;
    let mut total_output_tokens: Option<u64> = None;

    // Routes the three concurrent streams that the running turn cares about:
    //   1. inbound `approval_response` frames from the WebSocket client,
    //   2. `TurnEvent::ApprovalRequest` events from `WsApprovalChannel`,
    //   3. ordinary `TurnEvent`s from the agent loop.
    // Without the multiplexed select, the loop draining only `event_rx`
    // would block the approval back-channel for the whole turn, so a pending
    // tool approval could neither be sent to the client nor answered before
    // the timeout fired.
    let forward_fut = async {
        let mut cancel_drained = false;
        loop {
            tokio::select! {
                biased;
                // ── Cancellation arm ─────────────────────────────
                // When `/abort` cancels the token, immediately drop every
                // parked oneshot sender so any in-flight `request_approval`
                // unblocks via the "sender dropped → deny" path in
                // `WsApprovalChannel`. Without this, the approval future
                // races only its own `timeout_secs` (default 120s) and
                // ignores the cancel token, so the abort sits idle for up
                // to two minutes before the tool loop even gets a chance
                // to observe the cancellation.
                _ = cancel_token.cancelled(), if !cancel_drained => {
                    let drained: Vec<_> = pending_approvals.lock().drain().collect();
                    drop(drained);
                    cancel_drained = true;
                    // Fall through; the agent loop will now wake from the
                    // approval await, see the cancel token, and propagate
                    // a ToolLoopCancelled error which closes event_rx and
                    // breaks this loop on the `event_rx.recv()` arm below.
                }
                client_msg = receiver.next() => {
                    // On client disconnect, `receiver.next()` returns `None`
                    // (stream end) or `Err(_)` repeatedly. A bare `continue`
                    // hot-loops the select; cancel the turn so `turn_fut`
                    // resolves with `ToolLoopCancelled` and `tokio::join!`
                    // below can return. See #6514.
                    let text = match client_msg {
                        Some(Ok(Message::Text(text))) => text,
                        Some(Ok(Message::Close(_))) | Some(Err(_)) | None => {
                            cancel_token.cancel();
                            break;
                        }
                        _ => continue,
                    };
                    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) else {
                        let err = serde_json::json!({
                            "type": "error",
                            "message": "Invalid JSON. Send {\"type\":\"message\",\"content\":\"your text\"}",
                            "code": "INVALID_JSON"
                        });
                        let _ = sender.send(Message::Text(err.to_string().into())).await;
                        continue;
                    };
                    match parsed["type"].as_str() {
                        Some("approval_response") => {
                            let request_id = parsed["request_id"].as_str().unwrap_or("");
                            let decision = match parsed["decision"].as_str().unwrap_or("") {
                                "approve" => Some(ChannelApprovalResponse::Approve),
                                "always" => Some(ChannelApprovalResponse::AlwaysApprove),
                                "deny" => Some(ChannelApprovalResponse::Deny),
                                _ => None,
                            };
                            if request_id.is_empty() || decision.is_none() {
                                continue;
                            }
                            if let Some(tx) = pending_approvals.lock().remove(request_id) {
                                let _ = tx.send(decision.expect("checked above"));
                            } else {
                                ::zeroclaw_log::record!(DEBUG, ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note).with_attrs(::serde_json::json!({"request_id": request_id})), "approval_response with no matching pending request (mid-turn)");
                            }
                        }
                        Some("message") => {
                            let content = parsed["content"].as_str().unwrap_or("").to_string();
                            if content.is_empty() {
                                let err = serde_json::json!({
                                    "type": "error",
                                    "message": "Message content cannot be empty",
                                    "code": "EMPTY_CONTENT"
                                });
                                let _ = sender.send(Message::Text(err.to_string().into())).await;
                                continue;
                            }
                            match steering_tx.try_send(content) {
                                Ok(()) => {}
                                Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
                                    let err = serde_json::json!({
                                        "type": "error",
                                        "message": "Steering queue is full for the running turn",
                                        "code": "STEERING_QUEUE_FULL"
                                    });
                                    let _ = sender.send(Message::Text(err.to_string().into())).await;
                                }
                                Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
                                    let err = serde_json::json!({
                                        "type": "error",
                                        "message": "Running turn is no longer accepting steering messages",
                                        "code": "STEERING_CLOSED"
                                    });
                                    let _ = sender.send(Message::Text(err.to_string().into())).await;
                                }
                            }
                        }
                        _ => {}
                    }
                }
                approval = approval_event_rx.recv() => {
                    let Some(event) = approval else { continue };
                    if let TurnEvent::ApprovalRequest {
                        request_id,
                        tool_name,
                        arguments_summary,
                        timeout_secs,
                    } = event {
                        let frame = serde_json::json!({
                            "type": "approval_request",
                            "request_id": request_id,
                            "tool": tool_name,
                            "arguments_summary": arguments_summary,
                            "timeout_secs": timeout_secs,
                        });
                        let _ = sender.send(Message::Text(frame.to_string().into())).await;
                    }
                }
                event_opt = event_rx.recv() => {
                    let Some(event) = event_opt else { break };
                    let ws_msg = match event {
                        TurnEvent::Usage {
                            input_tokens,
                            output_tokens,
                            cost_usd: _,
                        } => {
                            if let Some(it) = input_tokens {
                                total_input_tokens = Some(total_input_tokens.unwrap_or(0) + it);
                            }
                            if let Some(ot) = output_tokens {
                                total_output_tokens = Some(total_output_tokens.unwrap_or(0) + ot);
                            }
                            continue;
                        }
                        TurnEvent::Chunk { ref delta } => {
                            accumulated_text.push_str(delta);
                            serde_json::json!({ "type": "chunk", "content": delta })
                        }
                        TurnEvent::Thinking { delta } => {
                            serde_json::json!({ "type": "thinking", "content": delta })
                        }
                        TurnEvent::ToolCall { id, name, args } => {
                            serde_json::json!({ "type": "tool_call", "id": id, "name": name, "args": args })
                        }
                        TurnEvent::ToolResult { id, name, output } => {
                            serde_json::json!({ "type": "tool_result", "id": id, "name": name, "output": output })
                        }
                        TurnEvent::ApprovalRequest {
                            request_id,
                            tool_name,
                            arguments_summary,
                            timeout_secs,
                        } => serde_json::json!({
                            "type": "approval_request",
                            "request_id": request_id,
                            "tool": tool_name,
                            "arguments_summary": arguments_summary,
                            "timeout_secs": timeout_secs,
                        }),
                    };
                    let _ = sender.send(Message::Text(ws_msg.to_string().into())).await;
                }
            }
        }
    };

    let (result, ()) = tokio::join!(turn_fut, forward_fut);

    // ── Remove cancel token (turn finished) ──────────────────────
    {
        state.cancel_tokens.lock().remove(session_key);
    }

    // Check if this turn was cancelled. `turn_streamed` propagates
    // `ToolLoopCancelled` through anyhow, so we detect it here.
    let was_cancelled = match &result {
        Err(e) => zeroclaw_runtime::agent::loop_::is_tool_loop_cancelled(&e.error),
        Ok(_) => false,
    };

    if was_cancelled {
        // BI-5: surface the persisted leaf + the resulting active leaf so the
        // client can rebind its placeholder and resume the right branch.
        let mut aborted_leaf: Option<String> = None;
        let mut aborted_active_leaf: Option<String> = None;
        if let Some(ref backend) = state.session_backend {
            // Persist whatever the turn produced as interrupted nodes; if no
            // assistant message was emitted, the fallback records a placeholder
            // assistant node (with any streamed text) so the interruption stays
            // visible and resumable — same intent as the old append path.
            let truncated = if accumulated_text.is_empty() {
                "[interrupted by user]".to_string()
            } else {
                format!("{accumulated_text}\n\n[interrupted by user]")
            };
            aborted_leaf = persist_turn_as_nodes(
                backend.as_ref(),
                session_key,
                content,
                &truncated,
                "interrupted",
                &turn_ids,
            );
            aborted_active_leaf = backend.get_active_leaf(session_key);
        }

        // Inform the client the turn was aborted
        let aborted = serde_json::json!({
            "type": "aborted",
            "node_id": aborted_leaf,
            "active_leaf": aborted_active_leaf,
        });
        let _ = sender.send(Message::Text(aborted.to_string().into())).await;

        // Set session state to idle
        if let Some(ref backend) = state.session_backend {
            let _ = backend.set_session_state(session_key, "idle", None);
        }

        // Broadcast agent_end event
        let _ = state.event_tx.send(serde_json::json!({
            "type": "agent_end",
            "model_provider": provider_label,
            "model": state.model,
        }));

        // Trace the cancelled turn so the doctor / replay tool sees it
        // alongside successful turns. #6001 follow-through.
        ::zeroclaw_log::record!(
            INFO,
            ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Cancel)
                .with_outcome(::zeroclaw_log::EventOutcome::Failure)
                .with_attrs(::serde_json::json!({
                    "model_provider": provider_label,
                    "model": state.model,
                    "session_key": session_key,
                    "reason": "interrupted by user",
                    "cancelled": true,
                    "trace_id": turn_id,
                })),
            "gateway_ws_turn"
        );

        return;
    }

    // The assistant node id this turn persisted under, surfaced on the done
    // frame so the client can bind its streamed placeholder to the server node.
    let mut persisted_leaf: Option<String> = None;
    match result {
        Ok(outcome) => {
            if let Some(ref backend) = state.session_backend {
                persisted_leaf = persist_turn_as_nodes(
                    backend.as_ref(),
                    session_key,
                    content,
                    &outcome.response,
                    "complete",
                    &turn_ids,
                );
            }

            // Save assistant memory to card SQLite DB (offloaded to blocking thread)
            // Alternate turns (regenerate/swipe) skip ALL memory feeds.
            if !is_alternate && let Some(ref cn) = character_name {
                let uname = user_name.as_deref().unwrap_or("User").to_string();
                let response = outcome.response.clone();
                let data_dir = state.config.read().data_dir.clone();
                let cn = cn.clone();
                tokio::task::spawn_blocking(move || {
                    let mem_store = zeroclaw_memory_sigil::ChatMemoryStore::new(
                        &std::path::PathBuf::from(&data_dir).join("chat_memory"),
                    );
                    let _ = mem_store.save_chat_memory(&cn, &uname, "assistant", &response);
                });
            }

            // Fire-and-forget memory consolidation so facts from WS sessions
            // are extracted to long-term memory (Daily + Core categories).
            if !is_alternate && state.auto_save {
                if let Some(mem) = ws_memory.clone() {
                    let model_provider = state.model_provider.clone();
                    let model = state.model.clone();
                    let temperature = state.temperature;
                    let user_msg = content.to_string();
                    let assistant_resp = outcome.response.clone();
                    tokio::spawn(async move {
                        if let Err(e) = zeroclaw_memory::consolidation::consolidate_turn(
                            model_provider.as_ref(),
                            &model,
                            temperature,
                            mem.as_ref(),
                            &user_msg,
                            &assistant_resp,
                        )
                        .await
                        {
                            ::zeroclaw_log::record!(
                                DEBUG,
                                ::zeroclaw_log::Event::new(
                                    module_path!(),
                                    ::zeroclaw_log::Action::Note
                                )
                                .with_attrs(::serde_json::json!({"error": format!("{}", e)})),
                                "WS memory consolidation skipped"
                            );
                        }
                    });
                } else {
                    ::zeroclaw_log::record!(
                        DEBUG,
                        ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note),
                        "WS memory consolidation skipped"
                    );
                }
            }

            // Sigil dreaming: fire-and-forget light sleep so the just-saved
            // assistant turn gets fact-extracted, deduped, and importance-
            // scored before the next user message arrives. Pure-Rust
            // heuristics run unconditionally; LLM enrichment activates only
            // when the agent has `enricher_provider` configured.
            //
            // Deep/REM sleep is intentionally NOT triggered here — those are
            // scheduled offline passes (daily / weekly) and belong on the
            // cron scheduler, not in the per-turn hot path.
            if !is_alternate && let Some(cn) = character_name.as_ref() {
                let config_snapshot = state.config.read().clone();
                let data_dir_dream = config_snapshot.data_dir.clone();
                let agent_alias_dream = agent_alias.to_string();
                let cn_dream = cn.clone();
                tokio::spawn(async move {
                    let pipeline = resolve_ws_dreaming_pipeline(
                        &config_snapshot,
                        &agent_alias_dream,
                        &data_dir_dream,
                    )
                    .await;
                    let report = pipeline.run_light_sleep(&cn_dream).await;
                    ::zeroclaw_log::record!(
                        DEBUG,
                        ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                            .with_attrs(::serde_json::json!({
                                "agent": &agent_alias_dream,
                                "character": &cn_dream,
                                "stage": report.stage,
                                "processed": report.memories_processed,
                                "created": report.memories_created,
                                "merged": report.memories_merged,
                                "promoted": report.memories_promoted,
                                "duration_ms": report.duration_ms,
                            })),
                        "Sigil dreaming light sleep completed"
                    );
                });
            }

            // Compute cost from accumulated tokens + configured pricing,
            // then write the cost record so /api/cost and costs.jsonl reflect
            // this turn. Done before the done frame so cost_usd can ride along.
            let total_tokens = match (total_input_tokens, total_output_tokens) {
                (Some(i), Some(o)) => Some(i.saturating_add(o)),
                (Some(i), None) => Some(i),
                (None, Some(o)) => Some(o),
                (None, None) => None,
            };
            let cost_usd = record_turn_cost(
                state,
                &provider_label,
                &state.model,
                total_input_tokens,
                total_output_tokens,
                None,
            );

            let done = serde_json::json!({
                "type": "done",
                "full_response": outcome.response,
                "input_tokens": total_input_tokens,
                "output_tokens": total_output_tokens,
                "tokens_used": total_tokens,
                "cost_usd": cost_usd,
                "model": state.model,
                "provider": provider_label,
                // The user's perceived affect this turn (null when confidence is
                // below the floor). The client tints the avatar's mood glow.
                "affect": affect_state,
                // The server-side conversation node this turn landed on, so the
                // client can bind its streamed placeholder to the tree.
                "node_id": persisted_leaf,
                // The active leaf after this turn. Equal to node_id today, but
                // sent explicitly so the frozen contract holds if they diverge.
                "active_leaf": persisted_leaf,
                // Context inspector: the memories recalled + injected for THIS
                // turn (empty string when none). Session-level prompt rides the
                // context_meta frame at connect.
                "recalled_memories": recalled_memories,
            });
            let _ = sender.send(Message::Text(done.to_string().into())).await;

            // Set session state to idle
            if let Some(ref backend) = state.session_backend {
                let _ = backend.set_session_state(session_key, "idle", None);
            }

            // Broadcast agent_end event
            let _ = state.event_tx.send(serde_json::json!({
                "type": "agent_end",
                "model_provider": provider_label,
                "model": state.model,
            }));

            // Append a runtime-trace.jsonl record so a `zeroclaw doctor`
            // sweep sees gateway WS turns alongside channel and CLI turns.
            // Closes the gateway-side trace gap from #6001.
            ::zeroclaw_log::record!(
                INFO,
                ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Complete)
                    .with_outcome(::zeroclaw_log::EventOutcome::Success)
                    .with_attrs(::serde_json::json!({
                        "model_provider": provider_label,
                        "model": state.model,
                        "session_key": session_key,
                        "input_tokens": total_input_tokens,
                        "output_tokens": total_output_tokens,
                        "tokens_used": total_tokens,
                        "cost_usd": cost_usd,
                        "trace_id": turn_id,
                    })),
                "gateway_ws_turn"
            );
        }
        Err(e) => {
            // BI-5: surface the persisted leaf + the resulting active leaf on the
            // error frame, mirroring the aborted frame.
            let mut error_leaf: Option<String> = None;
            let mut error_active_leaf: Option<String> = None;
            if let Some(ref backend) = state.session_backend {
                // Persist the user turn + a visible failed-assistant node so the
                // turn isn't silently lost and a retry has an anchor.
                let partial = if accumulated_text.is_empty() {
                    "[generation failed]".to_string()
                } else {
                    format!("{accumulated_text}\n\n[generation failed]")
                };
                error_leaf = persist_turn_as_nodes(
                    backend.as_ref(),
                    session_key,
                    content,
                    &partial,
                    "interrupted",
                    &turn_ids,
                );
                error_active_leaf = backend.get_active_leaf(session_key);
            }

            // Set session state to error
            if let Some(ref backend) = state.session_backend {
                let _ = backend.set_session_state(session_key, "error", Some(&turn_id));
            }

            ::zeroclaw_log::record!(
                ERROR,
                ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Fail)
                    .with_outcome(::zeroclaw_log::EventOutcome::Failure)
                    .with_attrs(::serde_json::json!({"error": format!("{}", e.error)})),
                "Agent turn failed"
            );
            let sanitized = zeroclaw_providers::sanitize_api_error(&e.error.to_string());
            let error_code = if sanitized.to_lowercase().contains("api key")
                || sanitized.to_lowercase().contains("authentication")
                || sanitized.to_lowercase().contains("unauthorized")
            {
                "AUTH_ERROR"
            } else if sanitized.to_lowercase().contains("model_provider")
                || sanitized.to_lowercase().contains("model")
            {
                "PROVIDER_ERROR"
            } else {
                "AGENT_ERROR"
            };
            let err = serde_json::json!({
                "type": "error",
                "message": sanitized,
                "code": error_code,
                "node_id": error_leaf,
                "active_leaf": error_active_leaf,
            });
            let _ = sender.send(Message::Text(err.to_string().into())).await;

            // Broadcast error event
            let _ = state.event_tx.send(serde_json::json!({
                "type": "error",
                "component": "ws_chat",
                "message": sanitized,
            }));

            // Trace the failed turn so the doctor / replay tool sees the
            // failure mode and the turn_id can be cross-referenced with
            // costs.jsonl. #6001 follow-through.
            ::zeroclaw_log::record!(
                WARN,
                ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Fail)
                    .with_outcome(::zeroclaw_log::EventOutcome::Failure)
                    .with_attrs(::serde_json::json!({
                        "model_provider": provider_label,
                        "model": state.model,
                        "session_key": session_key,
                        "error": sanitized,
                        "error_code": error_code,
                        "trace_id": turn_id,
                    })),
                "gateway_ws_turn"
            );
        }
    }
}

/// Record token usage for the just-completed turn against the gateway's
/// cost tracker, returning the computed cost in USD (or `None` when no
/// tracker is configured or no usage was reported).
fn record_turn_cost(
    state: &AppState,
    provider_name: &str,
    model: &str,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cached_input_tokens: Option<u64>,
) -> Option<f64> {
    let tracker = state.cost_tracker.as_ref()?;
    if input_tokens.is_none() && output_tokens.is_none() {
        return None;
    }
    let input = input_tokens.unwrap_or(0);
    let output = output_tokens.unwrap_or(0);
    let cached_input = cached_input_tokens.unwrap_or(0);
    if input == 0 && output == 0 {
        return None;
    }
    // V3 per-provider pricing lookup. Mirrors how the channels
    // orchestrator and the gateway lib.rs cost-tracking scope build
    // their `ModelProviderPricing`: walk every
    // `[model_providers.<type>.<alias>]` and key the per-profile
    // pricing map by `<type>.<alias>`. The streaming and non-streaming
    // paths derive identical costs because both bottom out in the same
    // `<type>.<alias>` key shape.
    let config = state.config.read();
    let pricing_map = config
        .providers
        .models
        .iter_entries()
        .filter(|(_, _, base)| !base.pricing.is_empty())
        .map(|(type_k, alias_k, base)| (format!("{type_k}.{alias_k}"), base.pricing.clone()))
        .collect::<std::collections::HashMap<String, std::collections::HashMap<String, f64>>>();
    drop(config);
    let model_pricing = pricing_map.get(provider_name);
    let try_lookup = |key: &str| -> (f64, f64, f64) {
        let Some(map) = model_pricing else {
            return (0.0, 0.0, 0.0);
        };
        let in_rate = map
            .get(&format!("{key}.input"))
            .copied()
            .or_else(|| map.get(key).copied())
            .unwrap_or(0.0);
        let out_rate = map
            .get(&format!("{key}.output"))
            .copied()
            .or_else(|| map.get(key).copied())
            .unwrap_or(0.0);
        let cached_rate = map
            .get(&format!("{key}.cached_input"))
            .copied()
            .unwrap_or(0.0);
        (in_rate, out_rate, cached_rate)
    };
    let (input_rate, output_rate, cached_rate) = match try_lookup(model) {
        (0.0, 0.0, 0.0) => model
            .rsplit_once('/')
            .map(|(_, suffix)| try_lookup(suffix))
            .unwrap_or((0.0, 0.0, 0.0)),
        rates => rates,
    };
    let usage = zeroclaw_runtime::cost::types::TokenUsage::new(
        model,
        input,
        output,
        cached_input,
        input_rate,
        output_rate,
        cached_rate,
    );
    let cost_usd = usage.cost_usd;
    if let Err(error) = tracker.record_usage(usage) {
        ::zeroclaw_log::record!(WARN, ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note).with_outcome(::zeroclaw_log::EventOutcome::Unknown).with_attrs(::serde_json::json!({"provider": provider_name, "model": model, "error": format!("{}", error)})), "Failed to record gateway turn cost");
    }
    Some(cost_usd)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    #[test]
    fn extract_ws_token_from_authorization_header() {
        let mut headers = HeaderMap::new();
        headers.insert("authorization", "Bearer zc_test123".parse().unwrap());
        assert_eq!(extract_ws_token(&headers, None), Some("zc_test123"));
    }

    #[test]
    fn extract_ws_token_from_subprotocol() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "sec-websocket-protocol",
            "zeroclaw.v1, bearer.zc_sub456".parse().unwrap(),
        );
        assert_eq!(extract_ws_token(&headers, None), Some("zc_sub456"));
    }

    #[test]
    fn extract_ws_token_from_query_param() {
        let headers = HeaderMap::new();
        assert_eq!(
            extract_ws_token(&headers, Some("zc_query789")),
            Some("zc_query789")
        );
    }

    #[test]
    fn extract_ws_token_precedence_header_over_subprotocol() {
        let mut headers = HeaderMap::new();
        headers.insert("authorization", "Bearer zc_header".parse().unwrap());
        headers.insert("sec-websocket-protocol", "bearer.zc_sub".parse().unwrap());
        assert_eq!(
            extract_ws_token(&headers, Some("zc_query")),
            Some("zc_header")
        );
    }

    #[test]
    fn extract_ws_token_precedence_subprotocol_over_query() {
        let mut headers = HeaderMap::new();
        headers.insert("sec-websocket-protocol", "bearer.zc_sub".parse().unwrap());
        assert_eq!(extract_ws_token(&headers, Some("zc_query")), Some("zc_sub"));
    }

    #[test]
    fn extract_ws_token_returns_none_when_empty() {
        let headers = HeaderMap::new();
        assert_eq!(extract_ws_token(&headers, None), None);
    }

    #[test]
    fn extract_ws_token_skips_empty_header_value() {
        let mut headers = HeaderMap::new();
        headers.insert("authorization", "Bearer ".parse().unwrap());
        assert_eq!(
            extract_ws_token(&headers, Some("zc_fallback")),
            Some("zc_fallback")
        );
    }

    #[test]
    fn extract_ws_token_skips_empty_query_param() {
        let headers = HeaderMap::new();
        assert_eq!(extract_ws_token(&headers, Some("")), None);
    }

    #[test]
    fn extract_ws_token_subprotocol_with_multiple_entries() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "sec-websocket-protocol",
            "zeroclaw.v1, bearer.zc_tok, other".parse().unwrap(),
        );
        assert_eq!(extract_ws_token(&headers, None), Some("zc_tok"));
    }

    #[test]
    fn session_scoped_events_only_match_their_session() {
        let target_event = serde_json::json!({
            "type": "message",
            "session_id": "operator-1",
            "content": "deploy finished"
        });
        let other_event = serde_json::json!({
            "type": "message",
            "session_id": "operator-2",
            "content": "different session"
        });
        let global_event = serde_json::json!({
            "type": "cron_result",
            "content": "global notification"
        });

        assert!(event_matches_session(&target_event, "operator-1"));
        assert!(!event_matches_session(&other_event, "operator-1"));
        assert!(event_matches_session(&global_event, "operator-1"));
    }

    #[tokio::test]
    async fn ws_memory_resolution_honors_agent_backend_none_over_install_backend() {
        use tempfile::TempDir;
        use zeroclaw_config::multi_agent::MemoryBackendKind;
        use zeroclaw_config::schema::{AliasedAgentConfig, Config};

        let tmp = TempDir::new().unwrap();
        let mut config = Config {
            data_dir: tmp.path().join("data"),
            config_path: tmp.path().join("config.toml"),
            ..Config::default()
        };
        std::fs::create_dir_all(&config.data_dir).unwrap();
        config.memory.backend = "sqlite.default".to_string();

        let mut agent = AliasedAgentConfig::default();
        agent.memory.backend = MemoryBackendKind::None;
        config.agents.insert("web".to_string(), agent);

        let memory = resolve_ws_memory_handle(&config, "web")
            .await
            .expect("WS per-agent memory resolution");

        assert!(
            memory.is_none(),
            "WebSocket consolidation must disable memory when the agent backend is none"
        );
    }

    #[test]
    fn resolve_session_cwd_uses_requested_cwd() {
        let requested = tempfile::tempdir().unwrap();
        let fallback = tempfile::tempdir().unwrap();
        let allowed = vec![requested.path().canonicalize().unwrap()];

        let resolved = resolve_session_cwd(
            Some(requested.path().to_str().unwrap()),
            &fallback.path().canonicalize().unwrap(),
            &allowed,
        )
        .unwrap();

        assert_eq!(resolved, requested.path().canonicalize().unwrap());
    }

    #[test]
    fn resolve_session_cwd_uses_default_workspace_without_request() {
        let fallback = tempfile::tempdir().unwrap();

        let resolved =
            resolve_session_cwd(None, &fallback.path().canonicalize().unwrap(), &[]).unwrap();

        assert_eq!(resolved, fallback.path().canonicalize().unwrap());
    }

    #[test]
    fn resolve_session_cwd_rejects_missing_directory() {
        let fallback = tempfile::tempdir().unwrap();
        let missing = fallback.path().join("missing");

        let err = resolve_session_cwd(
            Some(missing.to_str().unwrap()),
            &fallback.path().canonicalize().unwrap(),
            &[],
        )
        .expect_err("missing cwd should be rejected");

        assert!(err.to_string().contains("cwd is not a usable directory"));
    }

    #[test]
    fn resolve_session_cwd_rejects_cwd_outside_allowlist() {
        let requested = tempfile::tempdir().unwrap();
        let fallback = tempfile::tempdir().unwrap();
        // Allowlist points at an unrelated path; the requested cwd is
        // canonical and exists but is not in the allowlist.
        let unrelated = tempfile::tempdir().unwrap();
        let allowed = vec![unrelated.path().canonicalize().unwrap()];

        let err = resolve_session_cwd(
            Some(requested.path().to_str().unwrap()),
            &fallback.path().canonicalize().unwrap(),
            &allowed,
        )
        .expect_err("cwd outside allowlist should be rejected");

        assert!(err.to_string().contains("allowed_session_cwds"));
    }

    #[test]
    fn resolve_session_cwd_rejects_any_cwd_when_allowlist_empty() {
        let requested = tempfile::tempdir().unwrap();
        let fallback = tempfile::tempdir().unwrap();

        // No allowed_session_cwds entries — every client-supplied cwd is denied.
        let err = resolve_session_cwd(
            Some(requested.path().to_str().unwrap()),
            &fallback.path().canonicalize().unwrap(),
            &[],
        )
        .expect_err("empty allowlist should deny client-supplied cwd");

        assert!(err.to_string().contains("allowed_session_cwds"));
    }

    #[test]
    fn needs_onboarding_ws_error_points_to_onboard() {
        let config = zeroclaw_config::schema::Config::default();
        let frame = needs_onboarding_ws_error(&config)
            .expect("empty model must produce a WS onboarding error");

        assert_eq!(frame["type"], "error");
        assert_eq!(frame["error"], "needs_onboarding");
        assert_eq!(frame["code"], "NEEDS_ONBOARDING");
        assert_eq!(frame["url"], "/onboard");
        let message = frame["message"]
            .as_str()
            .expect("onboarding WS error must include a message");
        assert!(
            !message.starts_with('{') && !message.ends_with('}'),
            "missing Fluent key fallback leaked into WS error message: {message:?}"
        );
        assert!(
            message.to_lowercase().contains("onboarding"),
            "WS onboarding message must explain the setup gap: {message:?}"
        );
    }

    #[test]
    fn needs_onboarding_ws_error_uses_current_configured_model() {
        let mut config = zeroclaw_config::schema::Config::default();
        config.providers.models.openai.insert(
            "default".to_string(),
            zeroclaw_config::schema::OpenAIModelProviderConfig {
                base: zeroclaw_config::schema::ModelProviderConfig {
                    model: Some("openai/gpt-4o-mini".to_string()),
                    api_key: Some("sk-test".to_string()),
                    ..Default::default()
                },
            },
        );

        assert!(
            needs_onboarding_ws_error(&config).is_none(),
            "current configured model must allow WebSocket agent construction to continue"
        );
    }

    // Regression for #6514. The mid-turn `client_msg` arm in `forward_fut`
    // must (a) classify stream-end / close / error frames as "client gone"
    // and (b) cancel the turn token so `tokio::join!(turn_fut, forward_fut)`
    // can return — a bare `continue` hot-loops the select forever.
    #[derive(Debug, PartialEq, Eq)]
    enum DisconnectAction {
        Break,
        Continue,
        ProcessText,
    }

    fn classify_client_msg(
        msg: Option<Result<axum::extract::ws::Message, &'static str>>,
    ) -> DisconnectAction {
        use axum::extract::ws::Message;
        match msg {
            Some(Ok(Message::Text(_))) => DisconnectAction::ProcessText,
            Some(Ok(Message::Close(_))) | Some(Err(_)) | None => DisconnectAction::Break,
            _ => DisconnectAction::Continue,
        }
    }

    #[test]
    fn mid_turn_client_msg_breaks_on_stream_end_close_or_err() {
        use axum::extract::ws::Message;
        assert_eq!(classify_client_msg(None), DisconnectAction::Break);
        assert_eq!(
            classify_client_msg(Some(Ok(Message::Close(None)))),
            DisconnectAction::Break,
        );
        assert_eq!(
            classify_client_msg(Some(Err("io"))),
            DisconnectAction::Break,
        );
        assert_eq!(
            classify_client_msg(Some(Ok(Message::Ping(Default::default())))),
            DisconnectAction::Continue,
        );
        assert_eq!(
            classify_client_msg(Some(Ok(Message::Text("{}".into())))),
            DisconnectAction::ProcessText,
        );
    }

    #[test]
    fn mid_turn_disconnect_cancel_unblocks_joined_turn() {
        let token = tokio_util::sync::CancellationToken::new();
        let clone_for_turn = token.clone();
        assert!(!clone_for_turn.is_cancelled());
        token.cancel();
        assert!(
            clone_for_turn.is_cancelled(),
            "cloned token (held by turn_fut via agent.turn_streamed) must observe cancellation"
        );
    }

    #[test]
    fn session_queue_errors_map_to_explicit_websocket_codes() {
        use crate::session_queue::SessionQueueError;

        assert_eq!(
            session_queue_ws_error_code(&SessionQueueError::QueueFull {
                session_id: "gw_test".into(),
                depth: 2,
            }),
            "SESSION_QUEUE_FULL"
        );
        assert_eq!(
            session_queue_ws_error_code(&SessionQueueError::Timeout {
                session_id: "gw_test".into(),
            }),
            "SESSION_QUEUE_TIMEOUT"
        );
    }

    #[test]
    fn regenerate_reuses_user_node_creates_assistant_sibling() {
        // SR-1/BI-3: a regenerate resends the SAME user_msg_id with a NEW
        // assistant id. The user append conflicts (id reuse) but the existing
        // node IS a user node -> chain the new assistant under it. Result: one
        // user node, two assistant siblings — no duplicate user, no graft.
        use zeroclaw_infra::session_backend::SessionBackend;
        let tmp = tempfile::TempDir::new().unwrap();
        let backend =
            zeroclaw_infra::session_sqlite::SqliteSessionBackend::new(tmp.path()).unwrap();

        let ids1 = TurnNodeIds {
            parent_id: None,
            user_msg_id: Some("U".to_string()),
            assistant_msg_id: Some("A1".to_string()),
        };
        persist_turn_as_nodes(&backend, "s", "Q", "A1 answer", "complete", &ids1);

        let ids2 = TurnNodeIds {
            parent_id: None,
            user_msg_id: Some("U".to_string()),
            assistant_msg_id: Some("A2".to_string()),
        };
        persist_turn_as_nodes(&backend, "s", "Q", "A2 answer", "complete", &ids2);

        let tree = backend.load_tree("s");
        let users: Vec<_> = tree.iter().filter(|n| n.msg_id == "U").collect();
        assert_eq!(users.len(), 1, "exactly one user node U (no duplicate)");
        assert_eq!(users[0].role, "user");
        let mut asst_children: Vec<String> = tree
            .iter()
            .filter(|n| n.parent_id.as_deref() == Some("U") && n.role == "assistant")
            .map(|n| n.content.clone())
            .collect();
        asst_children.sort();
        assert_eq!(
            asst_children,
            vec!["A1 answer".to_string(), "A2 answer".to_string()]
        );
    }

    #[test]
    fn reused_assistant_id_upserts_content_not_dropped() {
        // SR-1: a reused assistant id collides on the UNIQUE index. The fallback
        // must UPSERT the fresh content via update_node, never silently drop it.
        use zeroclaw_infra::session_backend::SessionBackend;
        let tmp = tempfile::TempDir::new().unwrap();
        let backend =
            zeroclaw_infra::session_sqlite::SqliteSessionBackend::new(tmp.path()).unwrap();

        let ids1 = TurnNodeIds {
            parent_id: None,
            user_msg_id: Some("U1".to_string()),
            assistant_msg_id: Some("A".to_string()),
        };
        persist_turn_as_nodes(&backend, "s", "Q1", "first", "complete", &ids1);

        let ids2 = TurnNodeIds {
            parent_id: None,
            user_msg_id: Some("U2".to_string()),
            assistant_msg_id: Some("A".to_string()),
        };
        persist_turn_as_nodes(&backend, "s", "Q2", "second", "complete", &ids2);

        let tree = backend.load_tree("s");
        let a: Vec<_> = tree.iter().filter(|n| n.msg_id == "A").collect();
        assert_eq!(a.len(), 1, "still exactly one assistant node A");
        assert_eq!(
            a[0].content, "second",
            "reused id UPSERTs content, not dropped"
        );
    }

    #[test]
    fn assistant_id_colliding_with_nonassistant_node_mints_fresh_no_clobber() {
        // SR-1/BI-3 (symmetric guard): if assistant_msg_id collides with an
        // existing NON-assistant node (here a prior user node), the fallback must
        // NOT update_node (that would flip the node's role to "assistant" and
        // clobber its content while leaving parent_id dangling) — it must mint a
        // fresh assistant id instead. Mirrors the user-node role guard.
        use zeroclaw_infra::session_backend::SessionBackend;
        let tmp = tempfile::TempDir::new().unwrap();
        let backend =
            zeroclaw_infra::session_sqlite::SqliteSessionBackend::new(tmp.path()).unwrap();

        let ids1 = TurnNodeIds {
            parent_id: None,
            user_msg_id: Some("U".to_string()),
            assistant_msg_id: Some("A".to_string()),
        };
        persist_turn_as_nodes(&backend, "s", "Q1", "ans1", "complete", &ids1);

        // Turn 2 (user != assistant, so the handler guard passes) deliberately
        // reuses "U" as the assistant id — collides with the user node.
        let ids2 = TurnNodeIds {
            parent_id: None,
            user_msg_id: Some("U2".to_string()),
            assistant_msg_id: Some("U".to_string()),
        };
        let leaf = persist_turn_as_nodes(&backend, "s", "Q2", "second answer", "complete", &ids2);

        let tree = backend.load_tree("s");
        let u = tree
            .iter()
            .find(|n| n.msg_id == "U")
            .expect("node U survives");
        assert_eq!(u.role, "user", "U is NOT flipped to assistant");
        assert_eq!(u.content, "Q1", "U content NOT clobbered");
        // The fresh assistant carries the new content under the new user node.
        let fresh = tree
            .iter()
            .find(|n| n.role == "assistant" && n.content == "second answer")
            .expect("a fresh assistant node was minted");
        assert_ne!(
            fresh.msg_id, "U",
            "minted a fresh id, not the colliding one"
        );
        assert_eq!(fresh.parent_id.as_deref(), Some("U2"));
        assert_eq!(
            leaf.as_deref(),
            Some(fresh.msg_id.as_str()),
            "active leaf = fresh node"
        );
    }

    #[test]
    fn user_id_colliding_with_assistant_node_mints_fresh_no_graft() {
        // SR-1/BI-3 (user-path role guard): if user_msg_id collides with an
        // existing ASSISTANT node, chaining under it would graft the turn onto the
        // wrong node. Mint a fresh user id and append under the resolved parent.
        use zeroclaw_infra::session_backend::SessionBackend;
        let tmp = tempfile::TempDir::new().unwrap();
        let backend =
            zeroclaw_infra::session_sqlite::SqliteSessionBackend::new(tmp.path()).unwrap();

        let ids1 = TurnNodeIds {
            parent_id: None,
            user_msg_id: Some("U1".to_string()),
            assistant_msg_id: Some("A1".to_string()),
        };
        persist_turn_as_nodes(&backend, "s", "Q1", "ans1", "complete", &ids1);

        // Reuse "A1" (an assistant node) as the user id.
        let ids2 = TurnNodeIds {
            parent_id: None,
            user_msg_id: Some("A1".to_string()),
            assistant_msg_id: Some("A2".to_string()),
        };
        persist_turn_as_nodes(&backend, "s", "Q2", "ans2", "complete", &ids2);

        let tree = backend.load_tree("s");
        let a1 = tree
            .iter()
            .find(|n| n.msg_id == "A1")
            .expect("node A1 survives");
        assert_eq!(a1.role, "assistant", "A1 is NOT flipped to user");
        assert_eq!(a1.content, "ans1", "A1 content NOT clobbered");
        let fresh_user = tree
            .iter()
            .find(|n| n.role == "user" && n.content == "Q2")
            .expect("a fresh user node was minted");
        assert_ne!(
            fresh_user.msg_id, "A1",
            "minted a fresh user id, not the colliding one"
        );
        let a2 = tree
            .iter()
            .find(|n| n.msg_id == "A2")
            .expect("assistant A2 exists");
        assert_eq!(
            a2.parent_id.as_deref(),
            Some(fresh_user.msg_id.as_str()),
            "assistant chains under the fresh user node, not the grafted assistant"
        );
    }

    // ── Inc 3b: edit/delete free fns ──────────────────────────────────────

    #[test]
    fn apply_edit_updates_content_preserves_role() {
        // Inc 3b: edit is IN-PLACE — only content changes; role/parent/id stay.
        use zeroclaw_infra::session_backend::SessionBackend;
        let tmp = tempfile::TempDir::new().unwrap();
        let backend =
            zeroclaw_infra::session_sqlite::SqliteSessionBackend::new(tmp.path()).unwrap();

        let ids = TurnNodeIds {
            parent_id: None,
            user_msg_id: Some("U".to_string()),
            assistant_msg_id: Some("A".to_string()),
        };
        persist_turn_as_nodes(&backend, "s", "Q", "ans", "complete", &ids);

        assert!(apply_edit(&backend, "s", "A", "edited ans"));

        let tree = backend.load_tree("s");
        let a = tree
            .iter()
            .find(|n| n.msg_id == "A")
            .expect("node A exists");
        assert_eq!(a.content, "edited ans");
        assert_eq!(a.role, "assistant", "role preserved");
        assert_eq!(
            a.parent_id.as_deref(),
            Some("U"),
            "parent unchanged (in-place)"
        );
    }

    #[test]
    fn apply_edit_absent_returns_false() {
        // Inc 3b: editing an unknown id is a no-op write returning false.
        use zeroclaw_infra::session_backend::SessionBackend;
        let tmp = tempfile::TempDir::new().unwrap();
        let backend =
            zeroclaw_infra::session_sqlite::SqliteSessionBackend::new(tmp.path()).unwrap();

        let ids = TurnNodeIds {
            parent_id: None,
            user_msg_id: Some("U".to_string()),
            assistant_msg_id: Some("A".to_string()),
        };
        persist_turn_as_nodes(&backend, "s", "Q", "ans", "complete", &ids);
        let before = backend.load_tree("s");

        assert!(!apply_edit(&backend, "s", "ghost", "x"));

        let after = backend.load_tree("s");
        assert_eq!(before.len(), after.len(), "tree unchanged");
        assert_eq!(
            after.iter().find(|n| n.msg_id == "A").unwrap().content,
            "ans",
            "existing content untouched"
        );
    }

    #[test]
    fn apply_edit_legacy_linear_node() {
        // Inc 3b: a pre-tree linear row (NULL msg_id) surfaces as `lin-*` and
        // must be editable via Inc 3a's update_node rowid fallback.
        use zeroclaw_infra::session_backend::SessionBackend;
        let tmp = tempfile::TempDir::new().unwrap();
        let backend =
            zeroclaw_infra::session_sqlite::SqliteSessionBackend::new(tmp.path()).unwrap();

        backend
            .append(
                "s",
                &zeroclaw_api::model_provider::ChatMessage {
                    role: "user".to_string(),
                    content: "hello".to_string(),
                },
            )
            .unwrap();

        let lin_id = backend.load_tree("s")[0].msg_id.clone();
        assert!(lin_id.starts_with("lin-"), "synthesized legacy id");

        assert!(apply_edit(&backend, "s", &lin_id, "edited hello"));

        let tree = backend.load_tree("s");
        assert_eq!(
            tree[0].content, "edited hello",
            "legacy row edited by rowid"
        );
    }

    #[test]
    fn apply_delete_removes_subtree_returns_removed() {
        // Inc 3b: delete removes the node + its whole subtree, returns the ids.
        use zeroclaw_infra::session_backend::SessionBackend;
        let tmp = tempfile::TempDir::new().unwrap();
        let backend =
            zeroclaw_infra::session_sqlite::SqliteSessionBackend::new(tmp.path()).unwrap();

        // U -> A, then a regenerate branch under A: U2 -> A2.
        let ids1 = TurnNodeIds {
            parent_id: None,
            user_msg_id: Some("U".to_string()),
            assistant_msg_id: Some("A".to_string()),
        };
        persist_turn_as_nodes(&backend, "s", "Q", "ans", "complete", &ids1);
        let ids2 = TurnNodeIds {
            parent_id: Some("A".to_string()),
            user_msg_id: Some("U2".to_string()),
            assistant_msg_id: Some("A2".to_string()),
        };
        persist_turn_as_nodes(&backend, "s", "Q2", "ans2", "complete", &ids2);

        let mut removed = apply_delete(&backend, "s", "U2");
        removed.sort();
        assert_eq!(removed, vec!["A2".to_string(), "U2".to_string()]);

        let tree = backend.load_tree("s");
        assert!(
            !tree.iter().any(|n| n.msg_id == "U2" || n.msg_id == "A2"),
            "subtree gone"
        );
        assert!(tree.iter().any(|n| n.msg_id == "U"), "U remains");
        assert!(tree.iter().any(|n| n.msg_id == "A"), "A remains");
    }

    #[test]
    fn apply_delete_spares_parallel_sibling_branch() {
        // Inc 3b isolation invariant: deleting one branch must NOT touch a
        // parallel sibling branch — delete_subtree's BFS descends only via
        // parent_id, so siblings (and deeper descendants of siblings) survive.
        use zeroclaw_infra::session_backend::SessionBackend;
        let tmp = tempfile::TempDir::new().unwrap();
        let backend =
            zeroclaw_infra::session_sqlite::SqliteSessionBackend::new(tmp.path()).unwrap();

        // U has two assistant siblings A1 and A2 (regenerate); A2 is continued
        // with U2 -> A2b. Deleting A1 (a leaf sibling) must spare everything else.
        persist_turn_as_nodes(
            &backend,
            "s",
            "Q",
            "ans1",
            "complete",
            &TurnNodeIds {
                parent_id: None,
                user_msg_id: Some("U".into()),
                assistant_msg_id: Some("A1".into()),
            },
        );
        persist_turn_as_nodes(
            &backend,
            "s",
            "Q",
            "ans2",
            "complete",
            &TurnNodeIds {
                parent_id: None,
                user_msg_id: Some("U".into()),
                assistant_msg_id: Some("A2".into()),
            },
        );
        persist_turn_as_nodes(
            &backend,
            "s",
            "Q2",
            "ans2b",
            "complete",
            &TurnNodeIds {
                parent_id: Some("A2".into()),
                user_msg_id: Some("U2".into()),
                assistant_msg_id: Some("A2b".into()),
            },
        );

        let removed = apply_delete(&backend, "s", "A1");
        assert_eq!(
            removed,
            vec!["A1".to_string()],
            "only the A1 leaf is removed"
        );

        let tree = backend.load_tree("s");
        assert!(!tree.iter().any(|n| n.msg_id == "A1"), "A1 gone");
        for survivor in ["U", "A2", "U2", "A2b"] {
            assert!(
                tree.iter().any(|n| n.msg_id == survivor),
                "{survivor} survives the sibling delete"
            );
        }
    }

    #[test]
    fn apply_delete_root_leaves_read_path_coherent() {
        // Inc 3b: deleting the root (parent None) removes the whole tree. The
        // active leaf then dangles by design — but the read side filters an
        // unknown active_leaf, so load_active_path stays coherent (empty), not
        // a crash or a partial path.
        use zeroclaw_infra::session_backend::SessionBackend;
        let tmp = tempfile::TempDir::new().unwrap();
        let backend =
            zeroclaw_infra::session_sqlite::SqliteSessionBackend::new(tmp.path()).unwrap();

        persist_turn_as_nodes(
            &backend,
            "s",
            "Q",
            "ans",
            "complete",
            &TurnNodeIds {
                parent_id: None,
                user_msg_id: Some("U".into()),
                assistant_msg_id: Some("A".into()),
            },
        );

        let mut removed = apply_delete(&backend, "s", "U");
        removed.sort();
        assert_eq!(
            removed,
            vec!["A".to_string(), "U".to_string()],
            "whole tree removed"
        );

        assert!(
            backend.load_tree("s").is_empty(),
            "tree empty after root delete"
        );
        assert!(
            backend.load_active_path("s").is_empty(),
            "read path coherent (empty) despite a dangling active_leaf"
        );
    }

    #[test]
    fn apply_delete_resets_active_leaf_to_parent() {
        // Inc 3b: deleting a subtree that contains the active leaf resets the
        // active leaf to the deleted node's parent — never a removed id.
        use zeroclaw_infra::session_backend::SessionBackend;
        let tmp = tempfile::TempDir::new().unwrap();
        let backend =
            zeroclaw_infra::session_sqlite::SqliteSessionBackend::new(tmp.path()).unwrap();

        let ids1 = TurnNodeIds {
            parent_id: None,
            user_msg_id: Some("U".to_string()),
            assistant_msg_id: Some("A".to_string()),
        };
        persist_turn_as_nodes(&backend, "s", "Q", "ans", "complete", &ids1);
        let ids2 = TurnNodeIds {
            parent_id: Some("A".to_string()),
            user_msg_id: Some("U2".to_string()),
            assistant_msg_id: Some("A2".to_string()),
        };
        persist_turn_as_nodes(&backend, "s", "Q2", "ans2", "complete", &ids2);

        backend.set_active_leaf("s", "A2").unwrap();

        let removed = apply_delete(&backend, "s", "U2");

        let active = backend.get_active_leaf("s");
        assert_eq!(
            active.as_deref(),
            Some("A"),
            "active leaf reset to deleted node's parent"
        );
        assert!(
            !active.as_ref().is_some_and(|l| removed.contains(l)),
            "active leaf is never a removed id"
        );
    }

    #[test]
    fn apply_delete_legacy_linear_node() {
        // Inc 3b: deleting a legacy `lin-*` subtree must actually remove rows
        // via Inc 3a's delete_subtree rowid fallback (NULL msg_id never matches
        // the msg_id DELETE).
        use zeroclaw_infra::session_backend::SessionBackend;
        let tmp = tempfile::TempDir::new().unwrap();
        let backend =
            zeroclaw_infra::session_sqlite::SqliteSessionBackend::new(tmp.path()).unwrap();

        for (role, content) in [("user", "q1"), ("assistant", "a1"), ("user", "q2")] {
            backend
                .append(
                    "s",
                    &zeroclaw_api::model_provider::ChatMessage {
                        role: role.to_string(),
                        content: content.to_string(),
                    },
                )
                .unwrap();
        }

        let before = backend.load_tree("s");
        assert_eq!(before.len(), 3);
        // Delete from the second linear node down (it + its synthesized children).
        let target = before[1].msg_id.clone();
        assert!(target.starts_with("lin-"));

        let removed = apply_delete(&backend, "s", &target);
        assert!(!removed.is_empty(), "legacy subtree actually removed");

        let after = backend.load_tree("s");
        assert!(after.len() < before.len(), "row count dropped");
        assert!(!after.iter().any(|n| n.msg_id == target), "target row gone");
    }

    #[test]
    fn apply_delete_absent_returns_empty() {
        // Inc 3b: deleting an unknown id is a no-op returning an empty vec.
        use zeroclaw_infra::session_backend::SessionBackend;
        let tmp = tempfile::TempDir::new().unwrap();
        let backend =
            zeroclaw_infra::session_sqlite::SqliteSessionBackend::new(tmp.path()).unwrap();

        let ids = TurnNodeIds {
            parent_id: None,
            user_msg_id: Some("U".to_string()),
            assistant_msg_id: Some("A".to_string()),
        };
        persist_turn_as_nodes(&backend, "s", "Q", "ans", "complete", &ids);
        let before = backend.load_tree("s").len();

        assert!(apply_delete(&backend, "s", "ghost").is_empty());

        assert_eq!(backend.load_tree("s").len(), before, "tree unchanged");
    }

    #[test]
    fn detect_character_conflict_returns_none_when_no_session_character() {
        let parsed =
            serde_json::json!({"type": "message", "content": "hi", "character_name": "Aria"});
        assert!(detect_character_conflict(&parsed, &None).is_none());
    }

    #[test]
    fn detect_character_conflict_returns_none_when_no_incoming_character() {
        let parsed = serde_json::json!({"type": "message", "content": "hi"});
        let session = Some("Aria".to_string());
        assert!(detect_character_conflict(&parsed, &session).is_none());
    }

    #[test]
    fn detect_character_conflict_returns_none_when_same_character() {
        let parsed =
            serde_json::json!({"type": "message", "content": "hi", "character_name": "Aria"});
        let session = Some("Aria".to_string());
        assert!(detect_character_conflict(&parsed, &session).is_none());
    }

    #[test]
    fn detect_character_conflict_returns_some_when_different() {
        let parsed =
            serde_json::json!({"type": "message", "content": "hi", "character_name": "Bria"});
        let session = Some("Aria".to_string());
        let got = detect_character_conflict(&parsed, &session);
        assert_eq!(got, Some(("Aria".to_string(), "Bria".to_string())));
    }

    #[test]
    fn detect_character_conflict_ignores_empty_incoming() {
        let parsed = serde_json::json!({"type": "message", "content": "hi", "character_name": ""});
        let session = Some("Aria".to_string());
        assert!(detect_character_conflict(&parsed, &session).is_none());
    }

    #[test]
    fn build_character_prompt_components_errors_on_unknown_character() {
        let result = build_character_prompt_components(
            "ThisCharacterDoesNotExist12345",
            Some("play"),
            Some("User"),
            None,
            "",
        );
        assert!(result.is_err(), "unknown character must produce an error");
    }
}
