//! Tool subsystem for agent-callable capabilities.
//!
//! This module implements the tool execution surface exposed to the LLM during
//! agentic loops. Each tool implements the [`Tool`] trait defined in the
//! `traits` submodule, which requires a name, description, JSON parameter
//! schema, and an async `execute` method returning a structured [`ToolResult`].
//!
//! Tools are assembled into registries by [`default_tools`] (shell, file read/write)
//! and [`all_tools`] (full set including memory, browser, cron, HTTP, delegation,
//! and optional integrations). Security policy enforcement is injected via
//! [`SecurityPolicy`] at construction time.
//!
//! # Extension
//!
//! To add a new tool, implement [`Tool`] in a new submodule and register it in
//! [`all_tools_with_runtime`]. See `AGENTS.md` §7.3 for the full change playbook.

pub mod attribution;
pub mod cron_add;
pub(crate) mod cron_common;
pub mod cron_list;
pub mod cron_remove;
pub mod cron_run;
pub mod cron_runs;
pub mod cron_update;
pub mod delegate;
pub mod file_read;
pub mod model_switch;
pub mod read_skill;
pub mod schedule;
pub mod security_ops;
pub mod send_message_to_peer;
pub mod shell;
pub mod skill_http;
pub mod skill_tool;
pub mod sop_advance;
pub mod sop_approve;
pub mod sop_execute;
pub mod sop_list;
pub mod sop_status;
pub mod spawn_subagent;
pub mod verifiable_intent;

// Tool types from zeroclaw-tools (direct imports, no shims)
pub use zeroclaw_tools::ask_user::AskUserTool;
pub use zeroclaw_tools::ask_user::ChannelMapHandle;
pub use zeroclaw_tools::backup_tool::BackupTool;
pub use zeroclaw_tools::browser::{BrowserTool, ComputerUseConfig};
pub use zeroclaw_tools::browser_delegate::BrowserDelegateTool;
pub use zeroclaw_tools::browser_open::BrowserOpenTool;
pub use zeroclaw_tools::calculator::CalculatorTool;
pub use zeroclaw_tools::canvas::{ALLOWED_CONTENT_TYPES, MAX_CONTENT_SIZE};
pub use zeroclaw_tools::canvas::{CanvasStore, CanvasTool};
pub use zeroclaw_tools::cli_discovery::{DiscoveredCli, discover_cli_tools};
pub use zeroclaw_tools::cloud_ops::CloudOpsTool;
pub use zeroclaw_tools::cloud_patterns::CloudPatternsTool;
pub use zeroclaw_tools::content_search::ContentSearchTool;
pub use zeroclaw_tools::data_management::DataManagementTool;
pub use zeroclaw_tools::discord_search::DiscordSearchTool;
pub use zeroclaw_tools::escalate::EscalateToHumanTool;
pub use zeroclaw_tools::file_edit::FileEditTool;
pub use zeroclaw_tools::file_upload::FileUploadTool;
pub use zeroclaw_tools::file_write::FileWriteTool;
pub use zeroclaw_tools::git_operations::GitOperationsTool;
pub use zeroclaw_tools::glob_search::GlobSearchTool;
pub use zeroclaw_tools::hardware_board_info::HardwareBoardInfoTool;
pub use zeroclaw_tools::hardware_memory_map::HardwareMemoryMapTool;
pub use zeroclaw_tools::hardware_memory_read::HardwareMemoryReadTool;
pub use zeroclaw_tools::http_request::HttpRequestTool;
pub use zeroclaw_tools::image_gen::ImageGenTool;
pub use zeroclaw_tools::image_info::ImageInfoTool;
pub use zeroclaw_tools::knowledge_tool::KnowledgeTool;
pub use zeroclaw_tools::llm_task::LlmTaskTool;
pub use zeroclaw_tools::mcp_client::McpRegistry;
pub use zeroclaw_tools::mcp_deferred::{
    ActivatedToolSet, DeferredMcpToolSet, build_deferred_tools_section,
    build_deferred_tools_section_filtered,
};
pub use zeroclaw_tools::mcp_tool::McpToolWrapper;
pub use zeroclaw_tools::memory_export::MemoryExportTool;
pub use zeroclaw_tools::memory_forget::MemoryForgetTool;
pub use zeroclaw_tools::memory_purge::MemoryPurgeTool;
pub use zeroclaw_tools::memory_recall::MemoryRecallTool;
pub use zeroclaw_tools::memory_store::MemoryStoreTool;
pub use zeroclaw_tools::model_routing_config::ModelRoutingConfigTool;
pub use zeroclaw_tools::pipeline::PipelineTool;
pub use zeroclaw_tools::poll::PollTool;
pub use zeroclaw_tools::project_intel::ProjectIntelTool;
pub use zeroclaw_tools::proxy_config::ProxyConfigTool;
pub use zeroclaw_tools::pushover::PushoverTool;
pub use zeroclaw_tools::reaction::ReactionTool;
pub use zeroclaw_tools::report_template_tool::ReportTemplateTool;
pub use zeroclaw_tools::screenshot::ScreenshotTool;
pub use zeroclaw_tools::sessions::{
    SessionDeleteTool, SessionResetTool, SessionsCurrentTool, SessionsHistoryTool,
    SessionsListTool, SessionsSendTool,
};
pub use zeroclaw_tools::text_browser::TextBrowserTool;
pub use zeroclaw_tools::tool_search::ToolSearchTool;
pub use zeroclaw_tools::weather_tool::WeatherTool;
pub use zeroclaw_tools::web_fetch::WebFetchTool;
pub use zeroclaw_tools::web_search_tool::WebSearchTool;
pub use zeroclaw_tools::wrappers::{PathGuardedTool, RateLimitedTool};
pub use zeroclaw_tools::xai_image_gen::XaiImageGenTool;
pub use zeroclaw_tools::xai_tts::XaiTtsTool;

// Traits from zeroclaw-api
pub use zeroclaw_api::schema::{CleaningStrategy, SchemaCleanr};
pub use zeroclaw_api::tool::{Tool, ToolResult, ToolSpec};

// Local tool re-exports (tools with root deps, kept in misc)
pub use cron_add::CronAddTool;
pub use cron_list::CronListTool;
pub use cron_remove::CronRemoveTool;
pub use cron_run::CronRunTool;
pub use cron_runs::CronRunsTool;
pub use cron_update::CronUpdateTool;
pub use delegate::DelegateTool;
pub use file_read::FileReadTool;
pub use model_switch::ModelSwitchTool;
pub use read_skill::ReadSkillTool;
pub use schedule::ScheduleTool;
pub use security_ops::SecurityOpsTool;
pub use send_message_to_peer::SendMessageToPeerTool;
pub use shell::ShellTool;
pub use skill_http::SkillHttpTool;
pub use skill_tool::SkillShellTool;
pub use sop_advance::SopAdvanceTool;
pub use sop_approve::SopApproveTool;
pub use sop_execute::SopExecuteTool;
pub use sop_list::SopListTool;
pub use sop_status::SopStatusTool;
pub use spawn_subagent::SpawnSubagentTool;
pub use verifiable_intent::VerifiableIntentTool;

use crate::platform::{NativeRuntime, RuntimeAdapter};
use crate::security::{SecurityPolicy, create_sandbox};
use async_trait::async_trait;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;
use zeroclaw_config::schema::{AliasedAgentConfig, Config};
use zeroclaw_memory::Memory;

/// Shared handle to the delegate tool's parent-tools list.
/// Callers can push additional tools (e.g. MCP wrappers) after construction.
pub type DelegateParentToolsHandle = Arc<RwLock<Vec<Arc<dyn Tool>>>>;

/// Thin wrapper that makes an `Arc<dyn Tool>` usable as `Box<dyn Tool>`.
pub struct ArcToolRef(pub Arc<dyn Tool>);
// ArcToolRef is the public constructor name for ArcToolWrapper

#[async_trait]
impl Tool for ArcToolRef {
    fn name(&self) -> &str {
        self.0.name()
    }

    fn description(&self) -> &str {
        self.0.description()
    }

    fn parameters_schema(&self) -> serde_json::Value {
        self.0.parameters_schema()
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        self.0.execute(args).await
    }
}

#[derive(Clone)]
struct ArcDelegatingTool {
    inner: Arc<dyn Tool>,
}

impl ArcDelegatingTool {
    fn boxed(inner: Arc<dyn Tool>) -> Box<dyn Tool> {
        Box::new(Self { inner })
    }
}

impl ::zeroclaw_api::attribution::Attributable for ArcDelegatingTool {
    fn role(&self) -> ::zeroclaw_api::attribution::Role {
        self.inner.role()
    }
    fn alias(&self) -> &str {
        self.inner.alias()
    }
}

#[async_trait]
impl Tool for ArcDelegatingTool {
    fn name(&self) -> &str {
        self.inner.name()
    }

    fn description(&self) -> &str {
        self.inner.description()
    }

    fn parameters_schema(&self) -> serde_json::Value {
        self.inner.parameters_schema()
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        self.inner.execute(args).await
    }
}

fn boxed_registry_from_arcs(tools: Vec<Arc<dyn Tool>>) -> Vec<Box<dyn Tool>> {
    tools.into_iter().map(ArcDelegatingTool::boxed).collect()
}

/// Create the default tool registry
pub fn default_tools(security: Arc<SecurityPolicy>) -> Vec<Box<dyn Tool>> {
    default_tools_with_runtime(security, Arc::new(NativeRuntime::new()))
}

/// Create the default tool registry with explicit runtime adapter.
pub fn default_tools_with_runtime(
    security: Arc<SecurityPolicy>,
    runtime: Arc<dyn RuntimeAdapter>,
) -> Vec<Box<dyn Tool>> {
    vec![
        Box::new(RateLimitedTool::new(
            PathGuardedTool::new(ShellTool::new(security.clone(), runtime), security.clone()),
            security.clone(),
        )),
        Box::new(RateLimitedTool::new(
            PathGuardedTool::new(FileReadTool::new(security.clone()), security.clone()),
            security.clone(),
        )),
        Box::new(RateLimitedTool::new(
            PathGuardedTool::new(FileWriteTool::new(security.clone()), security.clone()),
            security.clone(),
        )),
        Box::new(RateLimitedTool::new(
            PathGuardedTool::new(FileEditTool::new(security.clone()), security.clone()),
            security.clone(),
        )),
        Box::new(RateLimitedTool::new(
            PathGuardedTool::new(GlobSearchTool::new(security.clone()), security.clone()),
            security.clone(),
        )),
        Box::new(RateLimitedTool::new(
            PathGuardedTool::new(ContentSearchTool::new(security.clone()), security.clone()),
            security,
        )),
    ]
}

/// Register skill-defined tools into an existing tool registry.
///
/// Converts each skill's `[[tools]]` entries into callable `Tool` implementations
/// and appends them to the registry. Skill tools that would shadow a built-in tool
/// name are skipped with a warning.
pub fn register_skill_tools(
    tools_registry: &mut Vec<Box<dyn Tool>>,
    skills: &[crate::skills::Skill],
    security: Arc<SecurityPolicy>,
) {
    if skills.is_empty() {
        return;
    }

    let before = tools_registry.len();
    let skill_tools = crate::skills::skills_to_tools(skills, security);
    let existing_names: std::collections::HashSet<String> = tools_registry
        .iter()
        .map(|t| t.name().to_string())
        .collect();
    for tool in skill_tools {
        if existing_names.contains(tool.name()) {
            ::zeroclaw_log::record!(
                WARN,
                ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                    .with_outcome(::zeroclaw_log::EventOutcome::Unknown),
                &format!(
                    "Skill tool '{}' shadows built-in tool, skipping",
                    tool.name()
                )
            );
        } else {
            tools_registry.push(tool);
        }
    }
    let registered = tools_registry.len() - before;

    // Positive-path log — matches how the rest of zeroclaw reports
    // successful initialization (open-skills clone, daemon startup,
    // gateway bind, etc.). Without this, a skill that audited clean,
    // parsed cleanly, and registered N tools leaves zero signal in the
    // log, which makes SKILL.toml / SKILL.md authoring painful to debug.
    ::zeroclaw_log::record!(
        INFO,
        ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note),
        &format!(
            "Registered {} skill tool(s) from {} skill(s): {}",
            registered,
            skills.len(),
            skills
                .iter()
                .map(|s| s.name.as_str())
                .collect::<Vec<_>>()
                .join(", "),
        )
    );
}

/// Always-on built-in tools that surface in the integrations panel as
/// `(display_name, description)` pairs. The integrations registry consumes
/// this verbatim — adding a new always-on built-in is one row here, no
/// edit to the registry. Tools with a config struct (Browser, Cron,
/// GoogleWorkspace) declare themselves via the `#[integration(...)]`
/// attribute on the schema struct instead.
pub const BUILTIN_TOOL_INTEGRATIONS: &[(&str, &str)] = &[
    ("Shell", "Terminal command execution"),
    ("File System", "Read/write files"),
    ("Weather", "Forecasts & conditions (wttr.in)"),
    (
        "Spawn SubAgent",
        "Spawn an ephemeral SubAgent that inherits this agent's identity",
    ),
];

/// Create full tool registry including memory tools and optional Composio
#[allow(
    clippy::implicit_hasher,
    clippy::too_many_arguments,
    clippy::type_complexity
)]
pub fn all_tools(
    config: Arc<Config>,
    security: &Arc<SecurityPolicy>,
    risk_profile: &zeroclaw_config::schema::RiskProfileConfig,
    agent_alias: &str,
    memory: Arc<dyn Memory>,
    browser_config: &zeroclaw_config::schema::BrowserConfig,
    http_config: &zeroclaw_config::schema::HttpRequestConfig,
    web_fetch_config: &zeroclaw_config::schema::WebFetchConfig,
    workspace_dir: &std::path::Path,
    agents: &HashMap<String, AliasedAgentConfig>,
    fallback_api_key: Option<&str>,
    root_config: &zeroclaw_config::schema::Config,
    canvas_store: Option<CanvasStore>,
    is_subagent_caller: bool,
) -> (
    Vec<Box<dyn Tool>>,
    Option<DelegateParentToolsHandle>,
    Option<ChannelMapHandle>,
    ChannelMapHandle,
    Option<ChannelMapHandle>,
    Option<ChannelMapHandle>,
) {
    all_tools_with_runtime(
        config,
        security,
        risk_profile,
        agent_alias,
        Arc::new(NativeRuntime::new()),
        memory,
        browser_config,
        http_config,
        web_fetch_config,
        workspace_dir,
        agents,
        fallback_api_key,
        root_config,
        canvas_store,
        is_subagent_caller,
    )
}

/// Create full tool registry including memory tools and optional Composio.
#[allow(
    clippy::implicit_hasher,
    clippy::too_many_arguments,
    clippy::type_complexity
)]
pub fn all_tools_with_runtime(
    config: Arc<Config>,
    security: &Arc<SecurityPolicy>,
    risk_profile: &zeroclaw_config::schema::RiskProfileConfig,
    agent_alias: &str,
    runtime: Arc<dyn RuntimeAdapter>,
    memory: Arc<dyn Memory>,
    browser_config: &zeroclaw_config::schema::BrowserConfig,
    http_config: &zeroclaw_config::schema::HttpRequestConfig,
    web_fetch_config: &zeroclaw_config::schema::WebFetchConfig,
    workspace_dir: &std::path::Path,
    agents: &HashMap<String, AliasedAgentConfig>,
    fallback_api_key: Option<&str>,
    root_config: &zeroclaw_config::schema::Config,
    canvas_store: Option<CanvasStore>,
    is_subagent_caller: bool,
) -> (
    Vec<Box<dyn Tool>>,
    Option<DelegateParentToolsHandle>,
    Option<ChannelMapHandle>,
    ChannelMapHandle,
    Option<ChannelMapHandle>,
    Option<ChannelMapHandle>,
) {
    let has_shell_access = runtime.has_shell_access();
    let runtime_kind = root_config.runtime.kind.as_str();
    let sandbox_cfg = risk_profile.sandbox_config();
    let sandbox = create_sandbox(&sandbox_cfg, runtime_kind, Some(&security.workspace_dir));
    let mut tool_arcs: Vec<Arc<dyn Tool>> = vec![
        Arc::new(RateLimitedTool::new(
            PathGuardedTool::new(
                ShellTool::new_with_sandbox(security.clone(), runtime, sandbox)
                    .with_timeout_secs(root_config.shell_tool.timeout_secs),
                security.clone(),
            ),
            security.clone(),
        )),
        Arc::new(RateLimitedTool::new(
            PathGuardedTool::new(FileReadTool::new(security.clone()), security.clone()),
            security.clone(),
        )),
        Arc::new(RateLimitedTool::new(
            PathGuardedTool::new(FileWriteTool::new(security.clone()), security.clone()),
            security.clone(),
        )),
        Arc::new(RateLimitedTool::new(
            PathGuardedTool::new(FileEditTool::new(security.clone()), security.clone()),
            security.clone(),
        )),
        Arc::new(RateLimitedTool::new(
            PathGuardedTool::new(GlobSearchTool::new(security.clone()), security.clone()),
            security.clone(),
        )),
        Arc::new(RateLimitedTool::new(
            PathGuardedTool::new(ContentSearchTool::new(security.clone()), security.clone()),
            security.clone(),
        )),
        Arc::new(CronAddTool::new(
            config.clone(),
            security.clone(),
            agent_alias,
        )),
        Arc::new(CronListTool::new(config.clone())),
        Arc::new(CronRemoveTool::new(config.clone(), security.clone())),
        Arc::new(CronUpdateTool::new(
            config.clone(),
            security.clone(),
            agent_alias,
        )),
        Arc::new(CronRunTool::new(config.clone(), security.clone())),
        Arc::new(CronRunsTool::new(config.clone())),
        Arc::new(MemoryStoreTool::new(memory.clone(), security.clone())),
        Arc::new(MemoryRecallTool::new(memory.clone())),
        Arc::new(MemoryForgetTool::new(memory.clone(), security.clone())),
        Arc::new(MemoryExportTool::new(memory.clone())),
        Arc::new(MemoryPurgeTool::new(memory.clone(), security.clone())),
        Arc::new(ScheduleTool::new(
            security.clone(),
            root_config.clone(),
            agent_alias,
        )),
        Arc::new(
            SpawnSubagentTool::new(Arc::new(root_config.clone()), agent_alias)
                .with_subagent_caller(is_subagent_caller),
        ),
        Arc::new(SendMessageToPeerTool::new(
            Arc::new(root_config.clone()),
            agent_alias,
        )),
        Arc::new(ModelRoutingConfigTool::new(
            config.clone(),
            security.clone(),
        )),
        Arc::new(ModelSwitchTool::new(security.clone())),
        Arc::new(ProxyConfigTool::new(config.clone(), security.clone())),
        Arc::new(GitOperationsTool::new(
            security.clone(),
            workspace_dir.to_path_buf(),
        )),
        Arc::new(PushoverTool::new(
            security.clone(),
            workspace_dir.to_path_buf(),
        )),
        Arc::new(CalculatorTool::new()),
        Arc::new(WeatherTool::new()),
        Arc::new(CanvasTool::new(canvas_store.unwrap_or_default())),
    ];

    // Register discord_search if any configured Discord alias has
    // archive enabled. Multiple Discord aliases are supported (one per
    // bot/server set); the search tool reads from a shared archive DB
    // so it's enabled when at least one alias archives.
    if root_config.channels.discord.values().any(|d| d.archive) {
        match zeroclaw_memory::SqliteMemory::new_named("sqlite", workspace_dir, "discord") {
            Ok(discord_mem) => {
                tool_arcs.push(Arc::new(DiscordSearchTool::new(Arc::new(discord_mem))));
            }
            Err(e) => {
                ::zeroclaw_log::record!(
                    WARN,
                    ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                        .with_outcome(::zeroclaw_log::EventOutcome::Unknown)
                        .with_attrs(::serde_json::json!({"error": format!("{}", e)})),
                    "discord_search: failed to open discord.db"
                );
            }
        }
    }

    // LLM task tool — always registered when a model_provider is configured
    {
        let llm_task_provider = root_config
            .first_model_provider_type()
            .unwrap_or("openrouter")
            .to_string();
        let llm_task_model = root_config
            .first_model_provider()
            .and_then(|e| e.model.clone())
            .unwrap_or_else(|| "openai/gpt-4o-mini".to_string());
        let llm_task_runtime_options =
            zeroclaw_providers::provider_runtime_options_from_config(root_config);
        tool_arcs.push(Arc::new(LlmTaskTool::new(
            security.clone(),
            llm_task_provider,
            llm_task_model,
            root_config
                .first_model_provider()
                .and_then(|e| e.temperature)
                .unwrap_or(0.7),
            root_config
                .first_model_provider()
                .and_then(|e| e.api_key.clone()),
            llm_task_runtime_options,
        )));
    }

    if matches!(
        root_config.skills.prompt_injection_mode,
        zeroclaw_config::schema::SkillsPromptInjectionMode::Compact
    ) {
        tool_arcs.push(Arc::new(ReadSkillTool::new(
            root_config.data_dir.clone(),
            root_config.skills.open_skills_enabled,
            root_config.skills.open_skills_dir.clone(),
            root_config.skills.allow_scripts,
        )));
    }

    if browser_config.enabled {
        // Add legacy browser_open tool for simple URL opening
        match BrowserOpenTool::new(security.clone(), browser_config.allowed_domains.clone()) {
            Ok(tool) => {
                tool_arcs.push(Arc::new(tool));
            }
            Err(e) => {
                ::zeroclaw_log::record!(
                    WARN,
                    ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                        .with_outcome(::zeroclaw_log::EventOutcome::Unknown)
                        .with_attrs(::serde_json::json!({"error": format!("{}", e)})),
                    "browser_open: failed to construct tool, skipping registration"
                );
            }
        }
        // Add full browser automation tool (pluggable backend)
        match BrowserTool::new_with_backend(
            security.clone(),
            browser_config.allowed_domains.clone(),
            browser_config.session_name.clone(),
            browser_config.backend.clone(),
            browser_config.headed,
            browser_config.native_headless,
            browser_config.native_webdriver_url.clone(),
            browser_config.native_chrome_path.clone(),
            ComputerUseConfig {
                endpoint: browser_config.computer_use.endpoint.clone(),
                api_key: browser_config.computer_use.api_key.clone(),
                timeout_ms: browser_config.computer_use.timeout_ms,
                allow_remote_endpoint: browser_config.computer_use.allow_remote_endpoint,
                window_allowlist: browser_config.computer_use.window_allowlist.clone(),
                max_coordinate_x: browser_config.computer_use.max_coordinate_x,
                max_coordinate_y: browser_config.computer_use.max_coordinate_y,
            },
        ) {
            Ok(tool) => {
                tool_arcs.push(Arc::new(RateLimitedTool::new(tool, security.clone())));
            }
            Err(e) => {
                ::zeroclaw_log::record!(
                    WARN,
                    ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                        .with_outcome(::zeroclaw_log::EventOutcome::Unknown)
                        .with_attrs(::serde_json::json!({"error": format!("{}", e)})),
                    "browser: failed to construct tool, skipping registration"
                );
            }
        }
    }

    // Browser delegation tool (conditionally registered; requires shell access)
    if root_config.browser_delegate.enabled {
        if has_shell_access {
            tool_arcs.push(Arc::new(BrowserDelegateTool::new(
                security.clone(),
                root_config.browser_delegate.clone(),
            )));
        } else {
            ::zeroclaw_log::record!(
                WARN,
                ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                    .with_outcome(::zeroclaw_log::EventOutcome::Unknown),
                "browser_delegate: skipped registration because the current runtime does not allow shell access"
            );
        }
    }

    if http_config.enabled {
        match HttpRequestTool::new(
            security.clone(),
            http_config.allowed_domains.clone(),
            http_config.max_response_size,
            http_config.timeout_secs,
            http_config.allow_private_hosts,
        ) {
            Ok(tool) => {
                tool_arcs.push(Arc::new(RateLimitedTool::new(tool, security.clone())));
            }
            Err(e) => {
                ::zeroclaw_log::record!(
                    WARN,
                    ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                        .with_outcome(::zeroclaw_log::EventOutcome::Unknown)
                        .with_attrs(::serde_json::json!({"error": format!("{}", e)})),
                    "http_request: failed to construct tool, skipping registration"
                );
            }
        }
    }

    if web_fetch_config.enabled {
        match WebFetchTool::new(
            security.clone(),
            web_fetch_config.allowed_domains.clone(),
            web_fetch_config.blocked_domains.clone(),
            web_fetch_config.max_response_size,
            web_fetch_config.timeout_secs,
            web_fetch_config.firecrawl.clone(),
            web_fetch_config.allowed_private_hosts.clone(),
        ) {
            Ok(tool) => {
                tool_arcs.push(Arc::new(RateLimitedTool::new(tool, security.clone())));
            }
            Err(e) => {
                ::zeroclaw_log::record!(
                    WARN,
                    ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                        .with_outcome(::zeroclaw_log::EventOutcome::Unknown)
                        .with_attrs(::serde_json::json!({"error": format!("{}", e)})),
                    "web_fetch: failed to construct tool, skipping registration"
                );
            }
        }
    }

    // Text browser tool (headless text-based browser rendering)
    if root_config.text_browser.enabled {
        tool_arcs.push(Arc::new(TextBrowserTool::new(
            security.clone(),
            root_config.text_browser.preferred_browser.clone(),
            root_config.text_browser.timeout_secs,
        )));
    }

    // Web search tool (enabled by default for GLM and other models)
    if root_config.web_search.enabled {
        tool_arcs.push(Arc::new(WebSearchTool::new_with_config(
            root_config.web_search.search_provider.clone(),
            root_config.web_search.brave_api_key.clone(),
            root_config.web_search.tavily_api_key.clone(),
            root_config.web_search.searxng_instance_url.clone(),
            root_config.web_search.max_results,
            root_config.web_search.timeout_secs,
            root_config.config_path.clone(),
            root_config.secrets.encrypt,
        )));
    }

    // Notion and Jira tools removed (tool implementations deleted)

    // Project delivery intelligence
    if root_config.project_intel.enabled {
        tool_arcs.push(Arc::new(ProjectIntelTool::new(
            root_config.project_intel.default_language.clone(),
            root_config.project_intel.risk_sensitivity.clone(),
        )));
        // Report template tool — direct access to template engine
        tool_arcs.push(Arc::new(ReportTemplateTool::new()));
    }

    // MCSS Security Operations
    if root_config.security_ops.enabled {
        tool_arcs.push(Arc::new(SecurityOpsTool::new(
            root_config.security_ops.clone(),
        )));
    }

    // Backup tool (enabled by default)
    if root_config.backup.enabled {
        tool_arcs.push(Arc::new(BackupTool::new(
            workspace_dir.to_path_buf(),
            root_config.backup.include_dirs.clone(),
            root_config.backup.max_keep,
        )));
    }

    // Data management tool (disabled by default)
    if root_config.data_retention.enabled {
        tool_arcs.push(Arc::new(DataManagementTool::new(
            workspace_dir.to_path_buf(),
            root_config.data_retention.retention_days,
        )));
    }

    // Cloud operations advisory tools (read-only analysis)
    if root_config.cloud_ops.enabled {
        tool_arcs.push(Arc::new(CloudOpsTool::new(root_config.cloud_ops.clone())));
        tool_arcs.push(Arc::new(CloudPatternsTool::new()));
    }

    // Vision tools are always available
    tool_arcs.push(Arc::new(ScreenshotTool::new(security.clone())));
    tool_arcs.push(Arc::new(RateLimitedTool::new(
        PathGuardedTool::new(ImageInfoTool::new(security.clone()), security.clone()),
        security.clone(),
    )));

    // Session tools share the channel orchestrator's backend via the
    // `make_session_backend` factory, keyed off `[channels].session_backend`.
    // Previously the tools opened the JSONL `SessionStore` while the
    // gateway WS path opened `SqliteSessionBackend`, so any session
    // created via /ws/chat was invisible to `sessions_list` /
    // `sessions_history`. Routing both call sites through the factory
    // closes that gap and honors the operator's configured backend.
    if let Ok(backend) =
        zeroclaw_infra::make_session_backend(workspace_dir, &config.channels.session_backend)
    {
        tool_arcs.push(Arc::new(SessionsCurrentTool::new(backend.clone())));
        tool_arcs.push(Arc::new(SessionsListTool::new(backend.clone())));
        tool_arcs.push(Arc::new(SessionsHistoryTool::new(
            backend.clone(),
            security.clone(),
        )));
        tool_arcs.push(Arc::new(SessionsSendTool::new(backend, security.clone())));
        // NOTE: SessionResetTool and SessionDeleteTool are available via
        // zeroclaw_tools::sessions but NOT registered by default. They are
        // destructive operations (clear/delete conversation history) and
        // should only be enabled by callers that explicitly need them
        // (e.g., orchestration dashboards). Agent-callable registrations must
        // use SessionOwnershipScope so one agent cannot reset/delete another
        // agent's sessions. The unscoped constructors are operator/admin only.
    }

    // Standalone image generation tool (config-gated)
    if root_config.image_gen.enabled {
        tool_arcs.push(Arc::new(ImageGenTool::new(
            security.clone(),
            workspace_dir.to_path_buf(),
            root_config.image_gen.default_model.clone(),
            root_config.image_gen.api_key_env.clone(),
        )));
    }

    // xAI image gen + TTS — gated on available runtime credentials, including
    // API key or XAI OAuth env overrides.
    let xai_fallback_key = root_config
        .first_model_provider()
        .and_then(|p| p.api_key.as_deref());
    let xai_has_credentials =
        zeroclaw_tools::xai_common::resolve_credentials(xai_fallback_key).is_ok();

    if xai_has_credentials {
        let xai_key = xai_fallback_key.map(std::string::ToString::to_string);
        tool_arcs.push(Arc::new(XaiImageGenTool::new(
            security.clone(),
            workspace_dir.to_path_buf(),
            "grok-imagine-image".to_string(),
            "1k".to_string(),
            xai_key.clone(),
        )));
        tool_arcs.push(Arc::new(XaiTtsTool::new(
            security.clone(),
            workspace_dir.to_path_buf(),
            "ara".to_string(),
            "en-US".to_string(),
            xai_key,
        )));
    }

    // File upload tool — enabled iff [file_upload].url is set
    if root_config
        .file_upload
        .url
        .as_deref()
        .is_some_and(|u| !u.trim().is_empty())
    {
        tool_arcs.push(Arc::new(FileUploadTool::new(
            security.clone(),
            root_config.file_upload.clone(),
        )));
    }

    // Poll tool — always registered; uses late-bound channel map handle
    let channel_map_handle: ChannelMapHandle = Arc::new(RwLock::new(HashMap::new()));
    tool_arcs.push(Arc::new(PollTool::new(
        security.clone(),
        Arc::clone(&channel_map_handle),
    )));

    // SOP tools (registered when sops_dir is configured)
    if root_config.sop.sops_dir.is_some() {
        let mut engine = crate::sop::SopEngine::new(root_config.sop.clone());
        engine.reload(workspace_dir);
        let sop_engine = Arc::new(std::sync::Mutex::new(engine));
        tool_arcs.push(Arc::new(SopListTool::new(Arc::clone(&sop_engine))));
        tool_arcs.push(Arc::new(SopExecuteTool::new(Arc::clone(&sop_engine))));
        tool_arcs.push(Arc::new(SopAdvanceTool::new(Arc::clone(&sop_engine))));
        tool_arcs.push(Arc::new(SopApproveTool::new(Arc::clone(&sop_engine))));
        tool_arcs.push(Arc::new(SopStatusTool::new(Arc::clone(&sop_engine))));
    }

    // Emoji reaction tool — always registered; channel map populated later by start_channels.
    let reaction_tool = ReactionTool::new(security.clone());
    let reaction_handle = reaction_tool.channel_map_handle();
    tool_arcs.push(Arc::new(reaction_tool));

    // Interactive ask_user tool — always registered; channel map populated later by start_channels.
    let ask_user_tool = AskUserTool::new(security.clone());
    let ask_user_handle = ask_user_tool.channel_map_handle();
    tool_arcs.push(Arc::new(ask_user_tool));

    // Human escalation tool — always registered; channel map populated later by start_channels.
    let escalate_tool = EscalateToHumanTool::new(
        security.clone(),
        root_config.escalation.alert_channels.clone(),
    );
    let escalate_handle = escalate_tool.channel_map_handle();
    tool_arcs.push(Arc::new(escalate_tool));

    // Knowledge graph tool
    if root_config.knowledge.enabled {
        let db_path_str = root_config.knowledge.db_path.replace(
            '~',
            &directories::UserDirs::new()
                .map(|u| u.home_dir().to_string_lossy().to_string())
                .unwrap_or_else(|| ".".to_string()),
        );
        let db_path = std::path::PathBuf::from(&db_path_str);
        match zeroclaw_memory::knowledge_graph::KnowledgeGraph::new(
            &db_path,
            root_config.knowledge.max_nodes,
        ) {
            Ok(graph) => {
                tool_arcs.push(Arc::new(KnowledgeTool::new(Arc::new(graph))));
            }
            Err(e) => {
                ::zeroclaw_log::record!(
                    WARN,
                    ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                        .with_outcome(::zeroclaw_log::EventOutcome::Unknown)
                        .with_attrs(::serde_json::json!({"error": format!("{}", e)})),
                    "knowledge graph disabled due to init error"
                );
            }
        }
    }

    // Add delegation tool when agents are configured
    let delegate_global_credential = fallback_api_key.and_then(|value| {
        let trimmed_value = value.trim();
        (!trimmed_value.is_empty()).then(|| trimmed_value.to_owned())
    });
    let provider_runtime_options =
        zeroclaw_providers::provider_runtime_options_from_config(root_config);

    let delegate_handle: Option<DelegateParentToolsHandle> = if agents.is_empty() {
        None
    } else {
        let delegate_agents: HashMap<String, AliasedAgentConfig> = agents
            .iter()
            .map(|(name, cfg)| (name.clone(), cfg.clone()))
            .collect();
        let parent_tools = Arc::new(RwLock::new(tool_arcs.clone()));
        let delegate_tool = DelegateTool::new_with_options(
            delegate_agents,
            delegate_global_credential.clone(),
            security.clone(),
            provider_runtime_options.clone(),
        )
        .with_parent_tools(Arc::clone(&parent_tools))
        .with_multimodal_config(root_config.multimodal.clone())
        .with_delegate_config(root_config.delegate.clone())
        .with_workspace_dir(workspace_dir.to_path_buf())
        .with_memory(memory.clone())
        .with_providers_models({
            // DelegateTool's signature still expects the flat HashMap shape;
            // collapse the typed ModelProviders container down to base-config
            // entries here. Family-specific extras (wire_api / requires_openai_auth /
            // resource / etc.) aren't needed by DelegateTool — it only resolves
            // baseline fields (model, api_key, uri) for sub-agent dispatch.
            // Phase 7 will switch DelegateTool to consume Arc<ModelProviders>
            // directly and drop this collapse.
            let mut m: std::collections::HashMap<
                String,
                std::collections::HashMap<String, zeroclaw_config::schema::ModelProviderConfig>,
            > = std::collections::HashMap::new();
            for (t, a, base) in root_config.providers.models.iter_entries() {
                m.entry(t.to_string())
                    .or_default()
                    .insert(a.to_string(), base.clone());
            }
            m
        })
        .with_risk_profiles(root_config.risk_profiles.clone())
        .with_runtime_profiles(root_config.runtime_profiles.clone())
        .with_skill_bundles(root_config.skill_bundles.clone())
        .with_root_config(config.clone());
        tool_arcs.push(Arc::new(delegate_tool));
        Some(parent_tools)
    };

    // Verifiable Intent tool (opt-in via config)
    if root_config.verifiable_intent.enabled {
        let strictness = match root_config.verifiable_intent.strictness.as_str() {
            "permissive" => crate::verifiable_intent::StrictnessMode::Permissive,
            _ => crate::verifiable_intent::StrictnessMode::Strict,
        };
        tool_arcs.push(Arc::new(VerifiableIntentTool::new(
            security.clone(),
            strictness,
        )));
    }

    // ── WASM plugin tools (requires plugins-wasm feature) ──
    #[cfg(feature = "plugins-wasm")]
    {
        let plugin_dir = config.plugins.plugins_dir.clone();
        let plugin_path = if plugin_dir.starts_with("~/") {
            let home = directories::UserDirs::new()
                .map(|u| u.home_dir().to_path_buf())
                .unwrap_or_else(|| std::path::PathBuf::from("."));
            home.join(plugin_dir.strip_prefix("~/").unwrap())
        } else {
            std::path::PathBuf::from(&plugin_dir)
        };

        if plugin_path.exists() && config.plugins.enabled {
            match zeroclaw_plugins::host::PluginHost::new(
                plugin_path.parent().unwrap_or(&plugin_path),
            ) {
                Ok(host) => {
                    let details = host.tool_plugin_details();
                    let count = details.len();
                    for (manifest, wasm_path) in details {
                        tool_arcs.push(Arc::new(zeroclaw_plugins::wasm_tool::WasmTool::from_wasm(
                            wasm_path.to_path_buf(),
                            manifest.permissions.clone(),
                            manifest.name.clone(),
                            manifest.description.clone().unwrap_or_default(),
                        )));
                    }
                    ::zeroclaw_log::record!(
                        INFO,
                        ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                            .with_attrs(::serde_json::json!({"count": count})),
                        "Loaded  WASM plugin tools"
                    );
                }
                Err(e) => {
                    ::zeroclaw_log::record!(
                        WARN,
                        ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                            .with_outcome(::zeroclaw_log::EventOutcome::Unknown)
                            .with_attrs(::serde_json::json!({"error": format!("{}", e)})),
                        "Failed to load WASM plugins"
                    );
                }
            }
        }
    }

    // Pipeline tool (execute_pipeline) — multi-step tool chaining.
    if root_config.pipeline.enabled {
        let pipeline_tools: Vec<Arc<dyn Tool>> = tool_arcs.clone();
        tool_arcs.push(Arc::new(PipelineTool::new(
            root_config.pipeline.clone(),
            pipeline_tools,
        )));
    }

    (
        boxed_registry_from_arcs(tool_arcs),
        delegate_handle,
        Some(reaction_handle),
        channel_map_handle,
        Some(ask_user_handle),
        Some(escalate_handle),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::sync::Mutex;
    use tempfile::TempDir;
    use zeroclaw_config::schema::{
        BrowserConfig, Config, MemoryConfig, ModelProviderConfig, XaiModelProviderConfig,
    };

    static XAI_ENV_MUTEX: Mutex<()> = Mutex::new(());

    fn with_env_var_kv(name: &str, value: Option<&str>) {
        match value {
            Some(v) => unsafe { std::env::set_var(name, v) },
            None => unsafe { std::env::remove_var(name) },
        }
    }

    struct EnvGuard {
        oauth_token: Option<OsString>,
        api_key: Option<OsString>,
    }

    impl EnvGuard {
        fn set_for_test(oauth: Option<&str>, api_key: Option<&str>) -> Self {
            let oauth_token = std::env::var_os("XAI_OAUTH_TOKEN");
            let api_key_value = std::env::var_os("XAI_API_KEY");
            with_env_var_kv("XAI_OAUTH_TOKEN", oauth);
            with_env_var_kv("XAI_API_KEY", api_key);
            Self {
                oauth_token,
                api_key: api_key_value,
            }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match self.oauth_token.clone() {
                Some(v) => unsafe { std::env::set_var("XAI_OAUTH_TOKEN", v) },
                None => unsafe { std::env::remove_var("XAI_OAUTH_TOKEN") },
            }
            match self.api_key.clone() {
                Some(v) => unsafe { std::env::set_var("XAI_API_KEY", v) },
                None => unsafe { std::env::remove_var("XAI_API_KEY") },
            }
        }
    }

    fn build_xai_root_config(tmp: &TempDir) -> Config {
        let mut cfg = test_config(tmp);
        cfg.providers.models.xai.insert(
            "default".to_string(),
            XaiModelProviderConfig {
                base: ModelProviderConfig {
                    model: Some("grok-imagine-image".to_string()),
                    api_key: None,
                    ..Default::default()
                },
            },
        );
        cfg
    }

    fn test_config(tmp: &TempDir) -> Config {
        Config {
            data_dir: tmp.path().join("data"),
            config_path: tmp.path().join("config.toml"),
            ..Config::default()
        }
    }

    #[test]
    fn default_tools_has_expected_count() {
        let security = Arc::new(SecurityPolicy::default());
        let tools = default_tools(security);
        assert_eq!(tools.len(), 6);
    }

    #[test]
    fn all_tools_excludes_browser_when_disabled() {
        let tmp = TempDir::new().unwrap();
        let security = Arc::new(SecurityPolicy::default());
        let mem_cfg = MemoryConfig {
            backend: "markdown".into(),
            ..MemoryConfig::default()
        };
        let mem: Arc<dyn Memory> =
            Arc::from(zeroclaw_memory::create_memory(&mem_cfg, tmp.path(), None).unwrap());

        let browser = BrowserConfig {
            enabled: false,
            allowed_domains: vec!["example.com".into()],
            session_name: None,
            ..BrowserConfig::default()
        };
        let http = zeroclaw_config::schema::HttpRequestConfig::default();
        let cfg = test_config(&tmp);

        let (tools, _, _, _, _, _) = all_tools(
            Arc::new(Config::default()),
            &security,
            &zeroclaw_config::schema::RiskProfileConfig::default(),
            "test-agent",
            mem,
            &browser,
            &http,
            &zeroclaw_config::schema::WebFetchConfig::default(),
            tmp.path(),
            &HashMap::new(),
            None,
            &cfg,
            None,
            false,
        );
        let names: Vec<&str> = tools.iter().map(|t| t.name()).collect();
        assert!(!names.contains(&"browser_open"));
        assert!(names.contains(&"schedule"));
        assert!(names.contains(&"model_routing_config"));
        assert!(names.contains(&"pushover"));
        assert!(names.contains(&"proxy_config"));
    }

    #[test]
    fn all_tools_includes_browser_when_enabled() {
        let tmp = TempDir::new().unwrap();
        let security = Arc::new(SecurityPolicy::default());
        let mem_cfg = MemoryConfig {
            backend: "markdown".into(),
            ..MemoryConfig::default()
        };
        let mem: Arc<dyn Memory> =
            Arc::from(zeroclaw_memory::create_memory(&mem_cfg, tmp.path(), None).unwrap());

        let browser = BrowserConfig {
            enabled: true,
            allowed_domains: vec!["example.com".into()],
            session_name: None,
            ..BrowserConfig::default()
        };
        let http = zeroclaw_config::schema::HttpRequestConfig::default();
        let cfg = test_config(&tmp);

        let (tools, _, _, _, _, _) = all_tools(
            Arc::new(Config::default()),
            &security,
            &zeroclaw_config::schema::RiskProfileConfig::default(),
            "test-agent",
            mem,
            &browser,
            &http,
            &zeroclaw_config::schema::WebFetchConfig::default(),
            tmp.path(),
            &HashMap::new(),
            None,
            &cfg,
            None,
            false,
        );
        let names: Vec<&str> = tools.iter().map(|t| t.name()).collect();
        assert!(names.contains(&"browser_open"));
        assert!(names.contains(&"content_search"));
        assert!(names.contains(&"model_routing_config"));
        assert!(names.contains(&"pushover"));
        assert!(names.contains(&"proxy_config"));
    }

    #[test]
    fn default_tools_names() {
        let security = Arc::new(SecurityPolicy::default());
        let tools = default_tools(security);
        let names: Vec<&str> = tools.iter().map(|t| t.name()).collect();
        assert!(names.contains(&"shell"));
        assert!(names.contains(&"file_read"));
        assert!(names.contains(&"file_write"));
        assert!(names.contains(&"file_edit"));
        assert!(names.contains(&"glob_search"));
        assert!(names.contains(&"content_search"));
    }

    #[test]
    fn default_tools_all_have_descriptions() {
        let security = Arc::new(SecurityPolicy::default());
        let tools = default_tools(security);
        for tool in &tools {
            assert!(
                !tool.description().is_empty(),
                "Tool {} has empty description",
                tool.name()
            );
        }
    }

    #[test]
    fn default_tools_all_have_schemas() {
        let security = Arc::new(SecurityPolicy::default());
        let tools = default_tools(security);
        for tool in &tools {
            let schema = tool.parameters_schema();
            assert!(
                schema.is_object(),
                "Tool {} schema is not an object",
                tool.name()
            );
            assert!(
                schema["properties"].is_object(),
                "Tool {} schema has no properties",
                tool.name()
            );
        }
    }

    #[test]
    fn tool_spec_generation() {
        let security = Arc::new(SecurityPolicy::default());
        let tools = default_tools(security);
        for tool in &tools {
            let spec = tool.spec();
            assert_eq!(spec.name, tool.name());
            assert_eq!(spec.description, tool.description());
            assert!(spec.parameters.is_object());
        }
    }

    #[test]
    fn tool_result_serde() {
        let result = ToolResult {
            success: true,
            output: "hello".into(),
            error: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        let parsed: ToolResult = serde_json::from_str(&json).unwrap();
        assert!(parsed.success);
        assert_eq!(parsed.output, "hello");
        assert!(parsed.error.is_none());
    }

    #[test]
    fn tool_result_with_error_serde() {
        let result = ToolResult {
            success: false,
            output: String::new(),
            error: Some("boom".into()),
        };
        let json = serde_json::to_string(&result).unwrap();
        let parsed: ToolResult = serde_json::from_str(&json).unwrap();
        assert!(!parsed.success);
        assert_eq!(parsed.error.as_deref(), Some("boom"));
    }

    #[test]
    fn tool_spec_serde() {
        let spec = ToolSpec {
            name: "test".into(),
            description: "A test tool".into(),
            parameters: serde_json::json!({"type": "object"}),
        };
        let json = serde_json::to_string(&spec).unwrap();
        let parsed: ToolSpec = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "test");
        assert_eq!(parsed.description, "A test tool");
    }

    #[test]
    fn all_tools_includes_delegate_when_agents_configured() {
        let tmp = TempDir::new().unwrap();
        let security = Arc::new(SecurityPolicy::default());
        let mem_cfg = MemoryConfig {
            backend: "markdown".into(),
            ..MemoryConfig::default()
        };
        let mem: Arc<dyn Memory> =
            Arc::from(zeroclaw_memory::create_memory(&mem_cfg, tmp.path(), None).unwrap());

        let browser = BrowserConfig::default();
        let http = zeroclaw_config::schema::HttpRequestConfig::default();
        let cfg = test_config(&tmp);

        let mut agents = HashMap::new();
        agents.insert(
            "researcher".to_string(),
            AliasedAgentConfig {
                model_provider: "ollama.researcher".into(),
                ..Default::default()
            },
        );

        let (tools, _, _, _, _, _) = all_tools(
            Arc::new(Config::default()),
            &security,
            &zeroclaw_config::schema::RiskProfileConfig::default(),
            "test-agent",
            mem,
            &browser,
            &http,
            &zeroclaw_config::schema::WebFetchConfig::default(),
            tmp.path(),
            &agents,
            Some("delegate-test-credential"),
            &cfg,
            None,
            false,
        );
        let names: Vec<&str> = tools.iter().map(|t| t.name()).collect();
        assert!(names.contains(&"delegate"));
    }

    #[test]
    fn all_tools_excludes_delegate_when_no_agents() {
        let tmp = TempDir::new().unwrap();
        let security = Arc::new(SecurityPolicy::default());
        let mem_cfg = MemoryConfig {
            backend: "markdown".into(),
            ..MemoryConfig::default()
        };
        let mem: Arc<dyn Memory> =
            Arc::from(zeroclaw_memory::create_memory(&mem_cfg, tmp.path(), None).unwrap());

        let browser = BrowserConfig::default();
        let http = zeroclaw_config::schema::HttpRequestConfig::default();
        let cfg = test_config(&tmp);

        let (tools, _, _, _, _, _) = all_tools(
            Arc::new(Config::default()),
            &security,
            &zeroclaw_config::schema::RiskProfileConfig::default(),
            "test-agent",
            mem,
            &browser,
            &http,
            &zeroclaw_config::schema::WebFetchConfig::default(),
            tmp.path(),
            &HashMap::new(),
            None,
            &cfg,
            None,
            false,
        );
        let names: Vec<&str> = tools.iter().map(|t| t.name()).collect();
        assert!(!names.contains(&"delegate"));
    }

    #[test]
    fn all_tools_includes_read_skill_in_compact_mode() {
        let tmp = TempDir::new().unwrap();
        let security = Arc::new(SecurityPolicy::default());
        let mem_cfg = MemoryConfig {
            backend: "markdown".into(),
            ..MemoryConfig::default()
        };
        let mem: Arc<dyn Memory> =
            Arc::from(zeroclaw_memory::create_memory(&mem_cfg, tmp.path(), None).unwrap());

        let browser = BrowserConfig::default();
        let http = zeroclaw_config::schema::HttpRequestConfig::default();
        let mut cfg = test_config(&tmp);
        cfg.skills.prompt_injection_mode =
            zeroclaw_config::schema::SkillsPromptInjectionMode::Compact;

        let (tools, _, _, _, _, _) = all_tools(
            Arc::new(cfg.clone()),
            &security,
            &zeroclaw_config::schema::RiskProfileConfig::default(),
            "test-agent",
            mem,
            &browser,
            &http,
            &zeroclaw_config::schema::WebFetchConfig::default(),
            tmp.path(),
            &HashMap::new(),
            None,
            &cfg,
            None,
            false,
        );
        let names: Vec<&str> = tools.iter().map(|t| t.name()).collect();
        assert!(names.contains(&"read_skill"));
    }

    #[test]
    fn all_tools_excludes_read_skill_in_full_mode() {
        let tmp = TempDir::new().unwrap();
        let security = Arc::new(SecurityPolicy::default());
        let mem_cfg = MemoryConfig {
            backend: "markdown".into(),
            ..MemoryConfig::default()
        };
        let mem: Arc<dyn Memory> =
            Arc::from(zeroclaw_memory::create_memory(&mem_cfg, tmp.path(), None).unwrap());

        let browser = BrowserConfig::default();
        let http = zeroclaw_config::schema::HttpRequestConfig::default();
        let mut cfg = test_config(&tmp);
        cfg.skills.prompt_injection_mode = zeroclaw_config::schema::SkillsPromptInjectionMode::Full;

        let (tools, _, _, _, _, _) = all_tools(
            Arc::new(cfg.clone()),
            &security,
            &zeroclaw_config::schema::RiskProfileConfig::default(),
            "test-agent",
            mem,
            &browser,
            &http,
            &zeroclaw_config::schema::WebFetchConfig::default(),
            tmp.path(),
            &HashMap::new(),
            None,
            &cfg,
            None,
            false,
        );
        let names: Vec<&str> = tools.iter().map(|t| t.name()).collect();
        assert!(!names.contains(&"read_skill"));
    }

    #[test]
    fn all_tools_includes_xai_tools_with_oauth_token_and_empty_config_key() {
        let _guard = XAI_ENV_MUTEX.lock().unwrap();
        let tmp = TempDir::new().unwrap();
        let security = Arc::new(SecurityPolicy::default());
        let mem_cfg = MemoryConfig {
            backend: "markdown".into(),
            ..MemoryConfig::default()
        };
        let mem: Arc<dyn Memory> =
            Arc::from(zeroclaw_memory::create_memory(&mem_cfg, tmp.path(), None).unwrap());

        let browser = BrowserConfig::default();
        let http = zeroclaw_config::schema::HttpRequestConfig::default();
        let cfg = build_xai_root_config(&tmp);
        let _env_guard = EnvGuard::set_for_test(Some("oauth-test-token"), None);

        let (tools, _, _, _, _, _) = all_tools(
            Arc::new(cfg.clone()),
            &security,
            &zeroclaw_config::schema::RiskProfileConfig::default(),
            "test-agent",
            mem,
            &browser,
            &http,
            &zeroclaw_config::schema::WebFetchConfig::default(),
            tmp.path(),
            &HashMap::new(),
            None,
            &cfg,
            None,
            false,
        );
        let names: Vec<&str> = tools.iter().map(|t| t.name()).collect();
        assert!(names.contains(&"xai_image_gen"));
        assert!(names.contains(&"xai_tts"));
    }

    #[test]
    fn all_tools_excludes_xai_tools_when_no_credentials() {
        let _guard = XAI_ENV_MUTEX.lock().unwrap();
        let tmp = TempDir::new().unwrap();
        let security = Arc::new(SecurityPolicy::default());
        let mem_cfg = MemoryConfig {
            backend: "markdown".into(),
            ..MemoryConfig::default()
        };
        let mem: Arc<dyn Memory> =
            Arc::from(zeroclaw_memory::create_memory(&mem_cfg, tmp.path(), None).unwrap());

        let browser = BrowserConfig::default();
        let http = zeroclaw_config::schema::HttpRequestConfig::default();
        let cfg = build_xai_root_config(&tmp);
        let _env_guard = EnvGuard::set_for_test(None, None);

        let (tools, _, _, _, _, _) = all_tools(
            Arc::new(cfg.clone()),
            &security,
            &zeroclaw_config::schema::RiskProfileConfig::default(),
            "test-agent",
            mem,
            &browser,
            &http,
            &zeroclaw_config::schema::WebFetchConfig::default(),
            tmp.path(),
            &HashMap::new(),
            None,
            &cfg,
            None,
            false,
        );
        let names: Vec<&str> = tools.iter().map(|t| t.name()).collect();
        assert!(!names.contains(&"xai_image_gen"));
        assert!(!names.contains(&"xai_tts"));
    }
}
