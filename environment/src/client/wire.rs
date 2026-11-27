//! Plugin起点のoperation宣言とWS RPCのwire型（docs/contracts/00004）。
//! operation / Execution model。旧tool model（tools.call / sync・async kind）は廃止。

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---- JSON-RPC 2.0 ----

#[derive(Debug, Serialize)]
pub struct Response {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Serialize)]
pub struct Notification {
    pub jsonrpc: &'static str,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// 受信メッセージの判別用の生構造。
#[derive(Debug, Deserialize)]
pub struct Incoming {
    #[allow(dead_code)]
    pub jsonrpc: Option<String>,
    pub id: Option<Value>,
    pub method: Option<String>,
    pub params: Option<Value>,
    pub result: Option<Value>,
    pub error: Option<RpcError>,
}

impl Incoming {
    pub fn is_request(&self) -> bool {
        self.method.is_some() && self.id.is_some()
    }
    pub fn is_notification(&self) -> bool {
        self.method.is_some() && self.id.is_none()
    }
    pub fn is_response(&self) -> bool {
        self.method.is_none()
    }
}

// WS接続上のmethod。Core → Pluginはoperations.invokeの転送、
// Plugin → Coreはoperations.eventの通知（contracts/00004）。
pub const METHOD_OPERATIONS_INVOKE: &str = "operations.invoke";
pub const METHOD_OPERATIONS_EVENT: &str = "operations.event";

/// PluginがWS接続上で受け取るoperations.invokeのparams。
/// Go側の wire.ForwardInvokeParams と同じ形。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardInvokeParams {
    pub operation: String,
    pub execution_id: String,
    #[serde(default)]
    pub input: Value,
}
