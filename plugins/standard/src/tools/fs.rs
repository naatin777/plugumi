//! fs/read・fs/write: ファイル読み書きのsync tool。

use super::Call;
use serde_json::{json, Value};

pub async fn read(call: &mut Call) -> Result<Value, String> {
    let path = call.input["path"].as_str().unwrap_or("");
    if path.is_empty() {
        return Err("input.path is required".into());
    }
    tokio::fs::read_to_string(path)
        .await
        .map(|content| json!({"path": path, "content": content}))
        .map_err(|e| e.to_string())
}

pub async fn write(call: &mut Call) -> Result<Value, String> {
    let path = call.input["path"].as_str().unwrap_or("");
    let content = call.input["content"].as_str().unwrap_or("").to_string();
    if path.is_empty() {
        return Err("input.path is required".into());
    }
    let bytes = content.len();
    tokio::fs::write(path, content)
        .await
        .map(|_| json!({"path": path, "bytes": bytes}))
        .map_err(|e| e.to_string())
}
