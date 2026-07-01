use jsonrpsee::proc_macros::rpc;
use jsonrpsee::core::RpcResult;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use std::sync::Arc;
use parking_lot::RwLock;
use zeroclaw_config::schema::Config;
use zeroclaw_infra::session_backend::SessionBackend;

#[derive(Clone)]
pub struct RpcState {
    pub config: Arc<RwLock<Config>>,
    pub session_backend: Option<Arc<dyn SessionBackend>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemInfo {
    pub version: String,
    pub session_persistence: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SessionTreeNodeDto {
    pub id: String,
    pub parent_id: Option<String>,
    pub role: String,
    pub content: String,
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SessionTreeDto {
    pub session_key: String,
    pub nodes: Vec<SessionTreeNodeDto>,
    pub active_leaf: Option<String>,
    pub session_persistence: bool,
}

#[derive(Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct MigrateNodeDto {
    pub id: String,
    pub parent_id: Option<String>,
    pub role: String,
    pub content: String,
    pub timestamp: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct MigrateRequest {
    pub session_key: String,
    pub nodes: Vec<MigrateNodeDto>,
    pub active_leaf: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MigrateResult {
    pub inserted: u64,
    pub skipped: u64,
}

#[rpc(server)]
pub trait RpcApi {
    #[method(name = "system_info")]
    async fn system_info(&self) -> RpcResult<SystemInfo>;

    #[method(name = "session_get_tree")]
    async fn session_get_tree(&self, session_key: String) -> RpcResult<SessionTreeDto>;

    #[method(name = "session_migrate")]
    async fn session_migrate(&self, req: MigrateRequest) -> RpcResult<MigrateResult>;
}

pub struct RpcServerImpl {
    state: RpcState,
}

#[async_trait::async_trait]
impl RpcApiServer for RpcServerImpl {
    async fn system_info(&self) -> RpcResult<SystemInfo> {
        Ok(SystemInfo {
            version: env!("CARGO_PKG_VERSION").to_string(),
            session_persistence: self.state.session_backend.is_some(),
        })
    }

    async fn session_get_tree(&self, session_key: String) -> RpcResult<SessionTreeDto> {
        let Some(backend) = &self.state.session_backend else {
            return Ok(SessionTreeDto {
                session_key,
                nodes: vec![],
                active_leaf: None,
                session_persistence: false,
            });
        };

        let nodes = backend.load_tree(&session_key);
        let active_leaf = backend.get_active_leaf(&session_key);

        Ok(SessionTreeDto {
            session_key,
            nodes: nodes
                .into_iter()
                .map(|n| SessionTreeNodeDto {
                    id: n.msg_id,
                    parent_id: n.parent_id,
                    role: n.role,
                    content: n.content,
                    timestamp: n.created_at.map(|dt| dt.to_rfc3339()),
                })
                .collect(),
            active_leaf,
            session_persistence: true,
        })
    }

    async fn session_migrate(&self, req: MigrateRequest) -> RpcResult<MigrateResult> {
        use zeroclaw_infra::session_backend::ConversationNode;

        let backend = self
            .state
            .session_backend
            .as_ref()
            .ok_or_else(|| jsonrpsee::types::ErrorObject::owned(-32000, "Session persistence is disabled", None::<()>))?;

        if req.session_key.trim().is_empty() {
            return Err(jsonrpsee::types::ErrorObject::owned(-32602, "session_key must not be empty", None::<()>));
        }

        let existing: std::collections::HashSet<String> = backend
            .load_tree(&req.session_key)
            .into_iter()
            .map(|n| n.msg_id)
            .collect();

        let mut known_ids = existing;
        let mut inserted: u64 = 0;
        let mut skipped: u64 = 0;

        for node in &req.nodes {
            if known_ids.contains(&node.id) {
                skipped += 1;
                continue;
            }
            if let Some(ref parent_id) = node.parent_id {
                if !known_ids.contains(parent_id) {
                    return Err(jsonrpsee::types::ErrorObject::owned(
                        -32602,
                        format!("Node {} references unknown parent {}", node.id, parent_id),
                        None::<()>,
                    ));
                }
            }

            let created_at = node.timestamp.as_ref().and_then(|ts| {
                chrono::DateTime::parse_from_rfc3339(ts)
                    .ok()
                    .map(|dt| dt.with_timezone(&chrono::Utc))
            });

            let conv = ConversationNode {
                msg_id: node.id.clone(),
                parent_id: node.parent_id.clone(),
                role: node.role.clone(),
                content: node.content.clone(),
                author_id: None,
                status: None,
                meta: None,
                created_at,
            };

            backend
                .append_node(&req.session_key, &conv)
                .map_err(|e| jsonrpsee::types::ErrorObject::owned(-32603, format!("Append failed: {e}"), None::<()>))?;

            known_ids.insert(node.id.clone());
            inserted += 1;
        }

        if let Some(ref leaf) = req.active_leaf {
            if known_ids.contains(leaf) {
                let _ = backend.set_active_leaf(&req.session_key, leaf);
            }
        }

        Ok(MigrateResult { inserted, skipped })
    }
}

pub fn build_rpc_module(state: RpcState) -> jsonrpsee::server::RpcModule<RpcServerImpl> {
    let impl_ = RpcServerImpl { state };
    impl_.into_rpc()
}
