//! Hardware memory read tool — read actual memory/register values from Nucleo via probe-rs.
//!
//! Use when user asks to "read register values", "read memory at address", "dump lower memory", etc.
//! Requires probe feature and Nucleo connected via USB.

use async_trait::async_trait;
use serde_json::json;
use zeroclaw_api::tool::{Tool, ToolResult};

/// RAM base for Nucleo-F401RE (STM32F401)
const NUCLEO_RAM_BASE: u64 = 0x2000_0000;

/// Tool: read memory at address from connected Nucleo via probe-rs.
pub struct HardwareMemoryReadTool {
    boards: Vec<String>,
}

impl HardwareMemoryReadTool {
    pub fn new(boards: Vec<String>) -> Self {
        Self { boards }
    }

    fn chip_for_board(board: &str) -> Option<&'static str> {
        match board {
            "nucleo-f401re" => Some("STM32F401RETx"),
            "nucleo-f411re" => Some("STM32F411RETx"),
            _ => None,
        }
    }
}

#[async_trait]
impl Tool for HardwareMemoryReadTool {
    fn name(&self) -> &str {
        "hardware_memory_read"
    }

    fn description(&self) -> &str {
        "Read actual memory/register values from Nucleo via USB. Use when: user asks to 'read register values', 'read memory at address', 'dump memory', 'lower memory 0-126', or 'give address and value'. Returns hex dump. Requires Nucleo connected via USB and probe feature. Params: address (hex, e.g. 0x20000000 for RAM start), length (bytes, default 128)."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "address": {
                    "type": "string",
                    "description": "Memory address in hex (e.g. 0x20000000 for RAM start). Default: 0x20000000 (RAM base)."
                },
                "length": {
                    "type": "integer",
                    "description": "Number of bytes to read (default 128, max 256)."
                },
                "board": {
                    "type": "string",
                    "description": "Board name (nucleo-f401re). Optional if only one configured."
                }
            }
        })
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        if self.boards.is_empty() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(
                    "No peripherals configured. Add nucleo-f401re to config.toml [peripherals.boards]."
                        .into(),
                ),
            });
        }

        let board = args
            .get("board")
            .and_then(|v| v.as_str())
            .map(String::from)
            .or_else(|| self.boards.first().cloned())
            .unwrap_or_else(|| "nucleo-f401re".into());

        let chip = Self::chip_for_board(&board);
        if chip.is_none() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!(
                    "Memory read only supports nucleo-f401re, nucleo-f411re. Got: {}",
                    board
                )),
            });
        }

        let address_str = args
            .get("address")
            .and_then(|v| v.as_str())
            .unwrap_or("0x20000000");
        let _address = parse_hex_address(address_str).unwrap_or(NUCLEO_RAM_BASE);

        let requested_length = args.get("length").and_then(|v| v.as_u64()).unwrap_or(128);
        let _length = usize::try_from(requested_length)
            .unwrap_or(256)
            .clamp(1, 256);

        // probe-rs integration removed — probe feature deleted
        {
            Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(
                    "Memory read requires probe feature which has been removed.".into(),
                ),
            })
        }
    }
}

fn parse_hex_address(s: &str) -> Option<u64> {
    let s = s.trim().trim_start_matches("0x").trim_start_matches("0X");
    u64::from_str_radix(s, 16).ok()
}
