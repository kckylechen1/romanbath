# Execution Plan: Fix xAI P0/P1 Issues

## P0 Critical Fixes

### 1. Security policy enforcement (all 3 tool files)
- Add `self.security.enforce_tool_operation(ToolOperation::Act, "<tool_name>")` check at the top of each `execute()` method
- Reference pattern: `image_gen.rs` L281-290
- Files: `xai_tts.rs`, `xai_image_gen.rs`, `xai_video_gen.rs`

### 2. Path traversal fix (all 3 tool files)
- Sanitize `output_filename` using `PathBuf::from(filename).file_name()` pattern
- Reference pattern: `image_gen.rs` L74-78
- Files: `xai_tts.rs`, `xai_image_gen.rs`, `xai_video_gen.rs`

### 3. Fix `run_pkce_flow` — remove blocking stdin
- Remove `std::io::stdin().read_line()` call
- Replace with loopback callback-only approach (bind first, display URL, accept connection)
- File: `xai_oauth.rs`

### 4. Fix `run_pkce_flow` — race condition (bind before display)
- Reorder: bind TCP listener → display URL → accept connection
- File: `xai_oauth.rs`

### 5. Fix `run_pkce_flow` — add accept timeout
- Wrap `listener.accept()` in `tokio::time::timeout(Duration::from_secs(180))`
- File: `xai_oauth.rs`

## P1 Medium Fixes

### 6. Extract shared credentials module
- Create `crates/zeroclaw-tools/src/xai_common.rs`
- Move `resolve_credentials()` and `http_client()` factory there
- Files: create `xai_common.rs`, update 3 tool files + `lib.rs`

### 7. Shared HTTP client factory (in xai_common.rs)
- Consolidate into a single `http_client()` with configurable timeout

### 8. Switch to tokio::fs
- Replace all `std::fs::create_dir_all`, `std::fs::write`, `std::fs::read` with `tokio::fs` equivalents
- Files: all 3 tool files

### 9. Reference image file size limit (10MB)
- In `xai_video_gen.rs`, check each reference image file size before encoding
- Also add to `xai_image_gen.rs` if it reads reference images

### 10. Fix refresh token rotation
- In `xai_oauth.rs` `refresh_token()`, prefer `token_response.refresh_token` over the original
- Currently line 199: `refresh_token: Some(refresh_token.to_string())` ignores the new token

### 11. Integrate xAI into AuthProvider enum
- Add `Xai` variant to `AuthProvider` in `mod.rs`
- Add `as_canonical()` arm, `XaiFlow` struct, update `flow()` dispatch
- Add `store_xai_tokens()` to `AuthService`
- Update `FromStr` error message

## Execution Order
1. Create `xai_common.rs` (P1 #6/#7)
2. Fix `xai_oauth.rs` (P0 #3/#4/#5, P1 #10)
3. Fix all 3 tool files (P0 #1/#2, P1 #8/#9, using xai_common)
4. Fix `mod.rs` (P1 #11)
5. Update `lib.rs` with new module
6. Compile-check
