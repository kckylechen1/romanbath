# Completion Report: Fix xAI P0/P1 Security Issues

## Summary

All 11 issues (5 P0 critical + 6 P1 medium) have been resolved. The code compiles cleanly, passes clippy with `-D warnings`, and all related tests pass.

## Files Changed

| File | Action | Changes |
|------|--------|---------|
| `crates/zeroclaw-tools/src/xai_common.rs` | **Created** | Shared credential resolution, HTTP client factory, filename sanitization, file size constant |
| `crates/zeroclaw-tools/src/xai_image_gen.rs` | **Created (replaced)** | Added security policy enforcement, path traversal fix, tokio::fs, shared utilities |
| `crates/zeroclaw-tools/src/xai_tts.rs` | **Created (replaced)** | Added security policy enforcement, path traversal fix, tokio::fs, shared utilities |
| `crates/zeroclaw-tools/src/xai_video_gen.rs` | **Created (replaced)** | Added security policy enforcement, path traversal fix, tokio::fs, 10MB file size limit, shared utilities |
| `crates/zeroclaw-tools/src/lib.rs` | **Modified** | Added `pub mod xai_common;` module declaration |
| `crates/zeroclaw-providers/src/auth/xai_oauth.rs` | **Created (replaced)** | Fixed PKCE flow: removed blocking stdin, bind-before-display, accept timeout; fixed refresh token rotation |
| `crates/zeroclaw-providers/src/auth/mod.rs` | **Modified** | Added `Xai` variant to `AuthProvider` enum, `store_xai_tokens()`, `XaiFlow` struct, dispatch wiring |

## P0 Fixes Applied

1. **Security policy enforcement** — All 3 tools now call `self.security.enforce_tool_operation(ToolOperation::Act, "<tool_name>")` at the top of `execute()`, matching `image_gen.rs` pattern.

2. **Path traversal fix** — All 3 tools now use `xai_common::sanitize_filename()` which strips path components via `PathBuf::file_name()`, matching `image_gen.rs` L74-78 pattern.

3. **Removed blocking stdin in `run_pkce_flow`** — The flow now binds the loopback listener first, displays the URL, then waits for the callback directly. No `std::io::stdin().read_line()` call.

4. **Fixed race condition** — TCP listener is now bound *before* the authorize URL is displayed, eliminating the window where the browser callback could arrive before the listener is ready.

5. **Added accept timeout** — `listener.accept()` is now wrapped in `tokio::time::timeout(Duration::from_secs(180))`.

## P1 Fixes Applied

6. **Shared credentials module** — Created `xai_common.rs` with `resolve_credentials()`, `http_client()`, `sanitize_filename()`.

7. **Shared HTTP client factory** — `xai_common::http_client(timeout_secs)` replaces duplicate `http_client()` methods in all 3 tools.

8. **tokio::fs** — All `std::fs::create_dir_all`, `std::fs::write`, `std::fs::read` calls replaced with `tokio::fs` equivalents.

9. **Reference image file size limit** — `xai_video_gen.rs` checks each reference image against `MAX_REFERENCE_IMAGE_BYTES` (10 MB) before reading/encoding.

10. **Refresh token rotation** — `xai_oauth::refresh_token()` now prefers the new `refresh_token` from the response, falling back to the original only when the provider doesn't issue a replacement.

11. **AuthProvider enum integration** — Added `Xai` variant with serde aliases (`grok`), `as_canonical()` returning `"xai"`, `XaiFlow` struct implementing `AuthProviderFlow` with `login()` and `refresh_status()`, and `store_xai_tokens()` on `AuthService`.

## Commands Run

```bash
cargo check --package zeroclaw-tools --package zeroclaw-providers
cargo fmt --all -- --check  # then auto-fixed with cargo fmt --all
cargo clippy --package zeroclaw-tools --package zeroclaw-providers -- -D warnings
cargo test --package zeroclaw-tools --package zeroclaw-providers
cargo test --package zeroclaw-providers -- xai  # xAI-specific tests
```

## Verification

- ✅ `cargo check` — both packages compile
- ✅ `cargo fmt --all -- --check` — clean (auto-formatted)
- ✅ `cargo clippy --package zeroclaw-tools --package zeroclaw-providers -- -D warnings` — zero warnings
- ✅ `cargo test --package zeroclaw-providers -- xai` — 2/2 tests pass (`test_build_authorize_url`, `factory_xai`)
- ✅ No `anyhow::anyhow!` usage (project-wide banned macro)
- ✅ No `&PathBuf` where `&Path` suffices
- ⚠️ `content_search::tests::content_search_basic_match` — pre-existing intermittent failure (reproduces on clean master), unrelated to this change set

## Remaining Risks or Blockers

- **No `get_valid_xai_access_token` method** — The `XaiFlow::refresh_status()` currently returns `NoProfile` because `AuthService` doesn't yet have a `get_valid_xai_access_token()` method with refresh backoff logic (comparable to the OpenAI/Gemini methods). This can be added in a follow-up when the xAI auth flow is fully wired into production use.
- **Pre-existing intermittent test** — `content_search_basic_match` is flaky under parallel test execution. Not introduced by this change set.
