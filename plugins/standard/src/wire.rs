//! Core↔Plugin契約のwire型（docs/contracts/00001-00003）。

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---- REST ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloRequest {
    pub protocol_version: String,
    pub session_id: String,
    pub registration_id: String,
    pub core: HelloCore,
}

#[derive(Debug, Deserialize)]
pub struct HelloCore {
    pub url: String,
    #[allow(dead_code)]
    pub version: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct HelloResponse {
    pub plugin: PluginInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDecl {
    pub tool_path: String,
    pub kind: String, // "sync" | "async"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsSetRequest {
    pub session_id: String,
    pub tools: Vec<ToolDecl>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingRequest {
    pub session_id: String,
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
    #[allow(dead_code)]
    pub fn is_response(&self) -> bool {
        self.method.is_none()
    }
}

pub const METHOD_CALL: &str = "tools.call";
pub const METHOD_CALL_OUTPUT: &str = "tools.call.output";
pub const METHOD_CALL_RESULT: &str = "tools.call.result";
pub const METHOD_CALL_CLOSE: &str = "tools.call.close";

/// target側へ届く呼出params（docs/contracts/00003:
/// 中継時はtargetへtoolPathのみ伝える）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallParams {
    pub tool_path: String,
    #[serde(default)]
    pub input: Value,
}
