//! Plugin起点のTool宣言とWS RPCのwire型（docs/contracts/00004）。

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDeclaration {
    pub tool_path: String,
    pub kind: String, // "sync" | "async"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

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

// transport（WS）上のmethodはtools.call系のみ。
pub const METHOD_CALL: &str = "tools.call";
pub const METHOD_CALL_CHUNK: &str = "tools.call.chunk";
pub const METHOD_CALL_RESULT: &str = "tools.call.result";
pub const METHOD_CALL_CLOSE: &str = "tools.call.close";

/// Pluginがtransport上で受け取るtools.callのparams。
/// caller→Core間では {target, input} 形だが、Coreが中継する際に
/// toolPathへ正規化される（docs/contracts/00003）。
/// Go側の wire.ForwardCallParams と同じ形。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardCallParams {
    pub tool_path: String,
    #[serde(default)]
    pub input: Value,
}
