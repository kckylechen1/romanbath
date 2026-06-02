use anyhow::Context;
use async_trait::async_trait;
use base64::Engine as _;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use zeroclaw_api::tool::{Tool, ToolResult};
use zeroclaw_config::policy::{SecurityPolicy, ToolOperation};

use crate::xai_common;

/// xAI image generation tool using Grok Imagine API.
///
/// Supports xAI API key or OAuth token for authentication.
/// Uses grok-imagine-image model with 1k/2k resolution options.
pub struct XaiImageGenTool {
    security: Arc<SecurityPolicy>,
    workspace_dir: PathBuf,
    default_model: String,
    default_resolution: String,
    fallback_api_key: Option<String>,
}

impl XaiImageGenTool {
    pub fn new(
        security: Arc<SecurityPolicy>,
        workspace_dir: PathBuf,
        default_model: String,
        default_resolution: String,
        fallback_api_key: Option<String>,
    ) -> Self {
        Self {
            security,
            workspace_dir,
            default_model,
            default_resolution,
            fallback_api_key,
        }
    }

    async fn download_url_image(
        url: &str,
        prefix: &str,
        workspace_dir: &Path,
    ) -> anyhow::Result<PathBuf> {
        let client = xai_common::http_client(120);
        let response = client
            .get(url)
            .send()
            .await
            .context("Failed to download image")?;

        if !response.status().is_success() {
            anyhow::bail!("Failed to download image from URL: {}", response.status());
        }

        let image_data = response
            .bytes()
            .await
            .context("Failed to read image data")?;
        let images_dir = workspace_dir.join("images");
        tokio::fs::create_dir_all(&images_dir)
            .await
            .context("Failed to create images directory")?;

        let filename = format!("{}_{}.png", prefix, chrono::Utc::now().timestamp_millis());
        let output_path = images_dir.join(filename);

        tokio::fs::write(&output_path, image_data)
            .await
            .context("Failed to write image file")?;
        Ok(output_path)
    }

    async fn save_b64_image(
        b64_data: &str,
        prefix: &str,
        workspace_dir: &Path,
    ) -> anyhow::Result<PathBuf> {
        let image_data = base64::engine::general_purpose::STANDARD
            .decode(b64_data)
            .context("Failed to decode base64 image data")?;

        let images_dir = workspace_dir.join("images");
        tokio::fs::create_dir_all(&images_dir)
            .await
            .context("Failed to create images directory")?;

        let filename = format!("{}_{}.png", prefix, chrono::Utc::now().timestamp_millis());
        let output_path = images_dir.join(filename);

        tokio::fs::write(&output_path, image_data)
            .await
            .context("Failed to write image file")?;
        Ok(output_path)
    }
}

zeroclaw_api::tool_attribution!(
    XaiImageGenTool,
    ::zeroclaw_api::attribution::ToolKind::Plugin
);

#[async_trait]
impl Tool for XaiImageGenTool {
    fn name(&self) -> &str {
        "xai_image_gen"
    }

    fn description(&self) -> &str {
        "Generate images using xAI Grok Imagine API. Supports text-to-image generation with various resolution options (1k or 2k)."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "Text prompt describing the image to generate"
                },
                "model": {
                    "type": "string",
                    "description": "Model ID (default: grok-imagine-image)",
                    "default": self.default_model
                },
                "resolution": {
                    "type": "string",
                    "description": "Image resolution: '1k' or '2k'",
                    "default": self.default_resolution,
                    "enum": ["1k", "2k"]
                },
                "output_filename": {
                    "type": "string",
                    "description": "Output filename prefix (without extension). Defaults to timestamp-based name."
                }
            },
            "required": ["prompt"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        // Security: image generation is a side-effecting action (HTTP + file write).
        if let Err(error) = self
            .security
            .enforce_tool_operation(ToolOperation::Act, "xai_image_gen")
        {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(error),
            });
        }

        let prompt = match args["prompt"].as_str() {
            Some(p) => p,
            None => {
                return Ok(ToolResult {
                    success: false,
                    output: String::new(),
                    error: Some("Missing 'prompt' parameter".to_string()),
                });
            }
        };
        let model = args["model"].as_str().unwrap_or(&self.default_model);
        let resolution = args["resolution"]
            .as_str()
            .unwrap_or(&self.default_resolution);
        let raw_filename = args["output_filename"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("xai_image");
        let prefix = xai_common::sanitize_filename(raw_filename, "xai_image");

        // Validate resolution
        if resolution != "1k" && resolution != "2k" {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!(
                    "Resolution must be '1k' or '2k', got: {}",
                    resolution
                )),
            });
        }

        // Resolve credentials
        let (auth_token, base_url) = match xai_common::resolve_credentials(self.fallback_api_key.as_deref()) {
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
        let url = format!("{}/images/generations", base_url);
        let client = xai_common::http_client(120);

        let request = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", auth_token))
            .header("Content-Type", "application/json")
            .json(&json!({
                "model": model,
                "prompt": prompt,
                "resolution": resolution
            }));

        let response = request
            .send()
            .await
            .context("Failed to send image generation request")?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!(
                    "xAI image generation failed ({}): {}",
                    status, error_body
                )),
            });
        }

        let response_body: serde_json::Value = response
            .json()
            .await
            .context("Failed to parse image generation response")?;

        let data = match response_body["data"].as_array() {
            Some(d) => d,
            None => {
                return Ok(ToolResult {
                    success: false,
                    output: String::new(),
                    error: Some("Missing 'data' array in response".to_string()),
                });
            }
        };

        if data.is_empty() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some("Empty data array in response".to_string()),
            });
        }

        let first_image = &data[0];
        let output_path = if let Some(b64_json) = first_image["b64_json"].as_str() {
            // Base64 encoded image
            Self::save_b64_image(b64_json, &prefix, &self.workspace_dir)
                .await
                .map_err(|e| anyhow::Error::msg(format!("Failed to save base64 image: {}", e)))?
        } else if let Some(img_url) = first_image["url"].as_str() {
            // URL response - cache locally to avoid expiration
            match Self::download_url_image(img_url, &prefix, &self.workspace_dir).await {
                Ok(path) => path,
                Err(_) => {
                    // Fallback to returning URL if download fails
                    return Ok(ToolResult {
                        success: true,
                        output: json!({
                            "image": img_url,
                            "provider": "xai",
                            "model": model,
                            "resolution": resolution,
                            "note": "URL could not be cached, using ephemeral URL"
                        })
                        .to_string(),
                        error: None,
                    });
                }
            }
        } else {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some("Response must contain either 'b64_json' or 'url'".to_string()),
            });
        };

        Ok(ToolResult {
            success: true,
            output: json!({
                "image": output_path.to_string_lossy(),
                "provider": "xai",
                "model": model,
                "resolution": resolution
            })
            .to_string(),
            error: None,
        })
    }
}
