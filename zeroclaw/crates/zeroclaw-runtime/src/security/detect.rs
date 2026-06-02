//! Auto-detection of available security features

use crate::security::traits::Sandbox;
use std::path::Path;
use std::sync::{Arc, Once};
use zeroclaw_config::schema::{SandboxBackend, SandboxConfig};

static SANDBOX_DEPRECATION_WARN_ONCE: Once = Once::new();

/// True when the caller's `SandboxConfig` shows explicit sandbox intent that
/// the operator needs to be told was ignored. `Auto` and `None` are the
/// default/unspecified values and must NOT trigger the per-call WARN.
fn explicit_sandbox_intent(sandbox: &SandboxConfig) -> bool {
    sandbox.enabled == Some(true)
        || !matches!(
            sandbox.backend,
            SandboxBackend::None | SandboxBackend::Auto
        )
}

/// Create a sandbox based on auto-detection or explicit config.
///
/// Sandbox backends (Docker, Firejail, Bubblewrap, Landlock, Seatbelt) have
/// been removed; this always returns `NoopSandbox`. The `enabled` and
/// `backend` fields on `SandboxConfig` remain in the schema for backward
/// compatibility but are ignored at runtime. See AGENTS.md §Sandbox
/// deprecation for the migration contract.
pub fn create_sandbox(
    sandbox: &SandboxConfig,
    _runtime_kind: &str,
    _workspace_dir: Option<&Path>,
) -> Arc<dyn Sandbox> {
    SANDBOX_DEPRECATION_WARN_ONCE.call_once(|| {
        ::zeroclaw_log::record!(
            WARN,
            ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Note)
                .with_outcome(::zeroclaw_log::EventOutcome::Unknown)
                .with_attrs(::serde_json::json!({
                    "removed_backends": ["docker", "firejail", "bubblewrap", "landlock", "seatbelt"],
                })),
            "Sandbox backends (Docker, Firejail, Bubblewrap, Landlock, Seatbelt) have been \
             removed in this release. All tool executions — including agent shell commands — \
             now run with NoopSandbox (no OS-level isolation). The agent runtime workspace is \
             the only remaining boundary; do not rely on [risk_profiles.*].sandbox_backend to \
             limit blast radius. See AGENTS.md §Sandbox deprecation for migration guidance."
        );
    });

    if explicit_sandbox_intent(sandbox) {
        ::zeroclaw_log::record!(
            WARN,
            ::zeroclaw_log::Event::new(module_path!(), ::zeroclaw_log::Action::Reject)
                .with_outcome(::zeroclaw_log::EventOutcome::Failure)
                .with_attrs(::serde_json::json!({
                    "configured_enabled": sandbox.enabled,
                    "configured_backend": format!("{:?}", sandbox.backend),
                })),
            "SandboxConfig requested a real sandbox but all backends were removed; \
             returning NoopSandbox. Remove the [risk_profiles.*].sandbox_enabled and \
             sandbox_backend entries from your config to silence this warning, or accept \
             that agent tool execution is no longer OS-isolated in this build."
        );
    }

    Arc::new(super::traits::NoopSandbox)
}

/// Returns true if the Linux kernel has the memory cgroup controller enabled.
///
/// Probes cgroup v2 (`/sys/fs/cgroup/memory.max`), then cgroup v1
/// (`/sys/fs/cgroup/memory/memory.limit_in_bytes`), then `/proc/cgroups`.
/// Any read error is treated as "absent" (conservative/safe direction).
#[cfg(target_os = "linux")]
pub fn linux_memcg_available() -> bool {
    use std::path::Path;

    if Path::new("/sys/fs/cgroup/memory.max").exists() {
        return true;
    }
    if Path::new("/sys/fs/cgroup/memory/memory.limit_in_bytes").exists() {
        return true;
    }
    if let Ok(content) = std::fs::read_to_string("/proc/cgroups") {
        for line in content.lines() {
            if line.starts_with('#') {
                continue;
            }
            let mut cols = line.split_whitespace();
            let name = cols.next().unwrap_or("");
            let _hierarchy = cols.next();
            let _num_cgroups = cols.next();
            let enabled = cols.next().unwrap_or("0");
            if name == "memory" && enabled == "1" {
                return true;
            }
        }
    }
    false
}

/// Non-Linux stub — always returns false.
/// Exists so the symbol compiles on all platforms (used in cross-platform tests).
#[cfg(not(target_os = "linux"))]
pub fn linux_memcg_available() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(enabled: Option<bool>, backend: SandboxBackend) -> SandboxConfig {
        SandboxConfig {
            enabled,
            backend,
            ..SandboxConfig::default()
        }
    }

    #[test]
    fn explicit_sandbox_intent_rejects_defaults() {
        // Default values (Auto + no explicit enabled) must NOT trigger the
        // per-call WARN — they're the "no opinion" baseline.
        assert!(!explicit_sandbox_intent(&cfg(None, SandboxBackend::Auto)));
        assert!(!explicit_sandbox_intent(&cfg(None, SandboxBackend::None)));
        assert!(!explicit_sandbox_intent(&cfg(Some(false), SandboxBackend::Auto)));
    }

    #[test]
    fn explicit_sandbox_intent_flags_enabled_true() {
        assert!(explicit_sandbox_intent(&cfg(Some(true), SandboxBackend::Auto)));
        assert!(explicit_sandbox_intent(&cfg(Some(true), SandboxBackend::None)));
    }

    #[test]
    fn explicit_sandbox_intent_flags_real_backends() {
        // Any non-default, non-None backend is an explicit operator choice.
        assert!(explicit_sandbox_intent(&cfg(None, SandboxBackend::Docker)));
        assert!(explicit_sandbox_intent(&cfg(None, SandboxBackend::Firejail)));
        assert!(explicit_sandbox_intent(&cfg(None, SandboxBackend::Landlock)));
        assert!(explicit_sandbox_intent(&cfg(None, SandboxBackend::Bubblewrap)));
        assert!(explicit_sandbox_intent(&cfg(None, SandboxBackend::SandboxExec)));
    }
}
