//! Auto-detection of available security features

use crate::security::traits::Sandbox;
use std::path::Path;
use std::sync::Arc;
use zeroclaw_config::schema::SandboxConfig;

/// Create a sandbox based on auto-detection or explicit config.
///
/// Sandbox backends (Docker, Firejail, Bubblewrap, Landlock, Seatbelt) have
/// been removed. Always returns `NoopSandbox` (application-layer security).
pub fn create_sandbox(
    _sandbox: &SandboxConfig,
    _runtime_kind: &str,
    _workspace_dir: Option<&Path>,
) -> Arc<dyn Sandbox> {
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
