use anyhow::Context;
use async_trait::async_trait;
use base64::Engine as _;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use zeroclaw_api::tool::{Tool, ToolResult};
use zeroclaw_config::policy::{SecurityPolicy, ToolOperation};

use crate::xai_common;

/// xAI video generation tool using Grok Imagine Video API.
///
/// Supports xAI API key or OAuth token for authentication.
/// Uses grok-imagine-video model with text-to-video and image-to-video capabilities.
pub struct XaiVideoGenTool {
    security: Arc<SecurityPolicy>,
    workspace_dir: PathBuf,
    default_model: String,
}

impl XaiVideoGenTool {
    pub fn new(
        security: Arc<SecurityPolicy>,
        workspace_dir: PathBuf,
        default_model: String,
    ) -> Self {
        Self {
            security,
            workspace_dir,
            default_model,
        }
    }

    async fn download_url_video(
        url: &str,
        prefix: &str,
        workspace_dir: &Path,
    ) -> anyhow::Result<PathBuf> {
        let client = xai_common::http_client(300);
        let response = client
            .get(url)
            .send()
            .await
            .context("Failed to download video")?;

        if !response.status().is_success() {
            anyhow::bail!("Failed to download video from URL: {}", response.status());
        }

        let video_data = response
            .bytes()
            .await
            .context("Failed to read video data")?;
        let videos_dir = workspace_dir.join("videos");
        tokio::fs::create_dir_all(&videos_dir)
            .await
            .context("Failed to create videos directory")?;

        let filename = format!("{}_{}.mp4", prefix, chrono::Utc::now().timestamp_millis());
        let output_path = videos_dir.join(filename);

        tokio::fs::write(&output_path, video_data)
            .await
            .context("Failed to write video file")?;
        Ok(output_path)
    }
}

zeroclaw_api::tool_attribution!(
    XaiVideoGenTool,
    ::zeroclaw_api::attribution::ToolKind::Plugin
);

#[async_trait]
impl Tool for XaiVideoGenTool {
    fn name(&self) -> &str {
        "xai_video_gen"
    }

    fn description(&self) -> &str {
        "Generate videos using xAI Grok Imagine Video API. Supports text-to-video and image-to-video generation with up to 7 reference images."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "Text prompt describing the video to generate"
                },
                "model": {
                    "type": "string",
                    "description": "Model ID (default: grok-imagine-video)",
                    "default": self.default_model
                },
                "reference_images": {
                    "type": "array",
                    "description": "Optional array of image file paths to use as reference (max 7)",
                    "items": {
                        "type": "string"
                    },
                    "maxItems": 7
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
        // Security: video generation is a side-effecting action (HTTP + file write).
        if let Err(error) = self
            .security
            .enforce_tool_operation(ToolOperation::Act, "xai_video_gen")
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
        let reference_images = args["reference_images"].as_array();
        let raw_filename = args["output_filename"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("xai_video");
        let prefix = xai_common::sanitize_filename(raw_filename, "xai_video");

        // Validate reference images count
        if let Some(ref_imgs) = reference_images
            && ref_imgs.len() > 7
        {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!(
                    "Maximum 7 reference images allowed, got {}",
                    ref_imgs.len()
                )),
            });
        }

        // Resolve credentials
        let (auth_token, base_url) = match xai_common::resolve_credentials(None).await {
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
        let url = format!("{}/videos/generations", base_url);
        let client = xai_common::http_client(300);

        let mut request_body = json!({
            "model": model,
            "prompt": prompt
        });

        // Add reference images if provided
        if let Some(ref_imgs) = reference_images
            && !ref_imgs.is_empty()
        {
            let mut encoded_images = Vec::new();
            for img_path_val in ref_imgs {
                let img_path = match img_path_val.as_str() {
                    Some(p) => p,
                    None => {
                        return Ok(ToolResult {
                            success: false,
                            output: String::new(),
                            error: Some("Reference image path must be a string".to_string()),
                        });
                    }
                };

                let metadata = tokio::fs::metadata(img_path).await.with_context(|| {
                    format!("Failed to read reference image metadata: {}", img_path)
                })?;

                if metadata.len() as usize > xai_common::MAX_REFERENCE_IMAGE_BYTES {
                    return Ok(ToolResult {
                        success: false,
                        output: String::new(),
                        error: Some(format!(
                            "Reference image '{}' exceeds 10 MB limit ({} bytes)",
                            img_path,
                            metadata.len()
                        )),
                    });
                }

                let img_data = tokio::fs::read(img_path)
                    .await
                    .with_context(|| format!("Failed to read reference image: {}", img_path))?;
                encoded_images.push(base64::engine::general_purpose::STANDARD.encode(img_data));
            }
            request_body["reference_images"] = json!(encoded_images);
        }

        let request = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", auth_token))
            .header("Content-Type", "application/json")
            .json(&request_body);

        let response = request
            .send()
            .await
            .context("Failed to send video generation request")?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!(
                    "xAI video generation failed ({}): {}",
                    status, error_body
                )),
            });
        }

        let response_body: serde_json::Value = response
            .json()
            .await
            .context("Failed to parse video generation response")?;

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

        let first_video = &data[0];
        let output_path: PathBuf = if let Some(vid_url) = first_video["url"].as_str() {
            // URL response - cache locally
            match Self::download_url_video(vid_url, &prefix, &self.workspace_dir).await {
                Ok(path) => path,
                Err(_) => {
                    // Fallback to returning URL if download fails
                    return Ok(ToolResult {
                        success: true,
                        output: json!({
                            "video": vid_url,
                            "provider": "xai",
                            "model": model,
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
                error: Some("Response must contain 'url' for video".to_string()),
            });
        };

        Ok(ToolResult {
            success: true,
            output: json!({
                "video": output_path.to_string_lossy(),
                "provider": "xai",
                "model": model,
                "reference_images_count": reference_images.map(|v| v.len()).unwrap_or(0)
            })
            .to_string(),
            error: None,
        })
    }
}
