use anyhow::Context;
use async_trait::async_trait;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use zeroclaw_api::tool::{Tool, ToolResult};
use zeroclaw_config::policy::{SecurityPolicy, ToolOperation};

use crate::xai_common;

/// xAI TTS tool using Grok's text-to-speech API.
///
/// Supports xAI API key or OAuth token for authentication.
pub struct XaiTtsTool {
    security: Arc<SecurityPolicy>,
    workspace_dir: PathBuf,
    default_voice_id: String,
    default_language: String,
}

impl XaiTtsTool {
    pub fn new(
        security: Arc<SecurityPolicy>,
        workspace_dir: PathBuf,
        default_voice_id: String,
        default_language: String,
    ) -> Self {
        Self {
            security,
            workspace_dir,
            default_voice_id,
            default_language,
        }
    }

    fn apply_auto_speech_tags(text: &str) -> String {
        // Add [pause] after first sentence if no explicit tags
        if !text.contains("[pause]")
            && !text.contains("[sigh]")
            && !text.contains("<slow>")
            && let Some(first_dot) = text.find(". ")
        {
            let before = &text[..first_dot + 1];
            let after = &text[first_dot + 2..];
            return format!("{} [pause] {}", before.trim(), after);
        }
        text.to_string()
    }
}

zeroclaw_api::tool_attribution!(XaiTtsTool, ::zeroclaw_api::attribution::ToolKind::Plugin);

#[async_trait]
impl Tool for XaiTtsTool {
    fn name(&self) -> &str {
        "xai_tts"
    }

    fn description(&self) -> &str {
        "Convert text to speech using xAI Grok's TTS API. Supports various voices and languages with automatic speech tag insertion for natural pauses and emphasis."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "The text to convert to speech"
                },
                "voice_id": {
                    "type": "string",
                    "description": "Voice ID (default: ara for French, en-US for English)",
                    "default": self.default_voice_id
                },
                "language": {
                    "type": "string",
                    "description": "Language code (e.g., fr, en-US, de)",
                    "default": self.default_language
                },
                "auto_speech_tags": {
                    "type": "boolean",
                    "description": "Automatically insert speech tags like [pause] for natural speech",
                    "default": true
                },
                "output_filename": {
                    "type": "string",
                    "description": "Output filename (without extension). Defaults to timestamp-based name."
                }
            },
            "required": ["text"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        // Security: TTS is a side-effecting action (HTTP + file write).
        if let Err(error) = self
            .security
            .enforce_tool_operation(ToolOperation::Act, "xai_tts")
        {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(error),
            });
        }

        let text = match args["text"].as_str() {
            Some(t) => t,
            None => {
                return Ok(ToolResult {
                    success: false,
                    output: String::new(),
                    error: Some("Missing 'text' parameter".to_string()),
                });
            }
        };
        let voice_id = args["voice_id"].as_str().unwrap_or(&self.default_voice_id);
        let language = args["language"].as_str().unwrap_or(&self.default_language);
        let auto_speech_tags = args["auto_speech_tags"].as_bool().unwrap_or(true);
        let raw_filename = args["output_filename"]
            .as_str()
            .filter(|s| !s.trim().is_empty());
        let filename = raw_filename
            .map(|f| xai_common::sanitize_filename(f, "xai_tts"))
            .unwrap_or_else(|| format!("xai_tts_{}", chrono::Utc::now().timestamp()));

        // Apply auto speech tags if enabled
        let processed_text = if auto_speech_tags {
            Self::apply_auto_speech_tags(text)
        } else {
            text.to_string()
        };

        // Resolve credentials
        let (auth_token, base_url) = match xai_common::resolve_credentials() {
            Ok(creds) => creds,
            Err(e) => {
                return Ok(ToolResult {
                    success: false,
                    output: String::new(),
                    error: Some(format!("Failed to resolve xAI credentials: {}", e)),
                });
            }
        };

        // Build request
        let url = format!("{}/tts", base_url);
        let client = xai_common::http_client(60);

        let request = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", auth_token))
            .header("Content-Type", "application/json")
            .json(&json!({
                "text": processed_text,
                "voice_id": voice_id,
                "language": language
            }));

        let response = request.send().await.context("Failed to send TTS request")?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!(
                    "xAI TTS request failed ({}): {}",
                    status, error_body
                )),
            });
        }

        // Save audio file
        let audio_data = response
            .bytes()
            .await
            .context("Failed to read audio data")?;
        let audio_dir = self.workspace_dir.join("audio");
        tokio::fs::create_dir_all(&audio_dir)
            .await
            .context("Failed to create audio directory")?;

        let output_path = audio_dir.join(format!("{}.mp3", filename));

        tokio::fs::write(&output_path, audio_data)
            .await
            .context("Failed to write audio file")?;

        Ok(ToolResult {
            success: true,
            output: json!({
                "audio_file": output_path.to_string_lossy(),
                "format": "mp3",
                "voice_id": voice_id,
                "language": language,
                "text_length": text.len()
            })
            .to_string(),
            error: None,
        })
    }
}
