//! fs/read・fs/write — ファイル読み書きのsync tool。

use super::{boxed, mkdef, Call, Handler, ToolDef};
use serde_json::{json, Value};

pub(super) fn read_def() -> ToolDef {
    mkdef("fs/read", "sync", Handler::Sync(read))
}

pub(super) fn write_def() -> ToolDef {
    mkdef("fs/write", "sync", Handler::Sync(write))
}

fn read(call: &mut Call) -> super::BoxFut<Result<Value, String>> {
    let path = call.input["path"].as_str().unwrap_or("").to_string();
    boxed(async move {
        if path.is_empty() {
            return Err("input.path is required".into());
        }
        tokio::fs::read_to_string(&path)
            .await
            .map(|content| json!({"path": path, "content": content}))
            .map_err(|e| e.to_string())
    })
}

fn write(call: &mut Call) -> super::BoxFut<Result<Value, String>> {
    let path = call.input["path"].as_str().unwrap_or("").to_string();
    let content = call.input["content"].as_str().unwrap_or("").to_string();
    boxed(async move {
        if path.is_empty() {
            return Err("input.path is required".into());
        }
        let bytes = content.len();
        tokio::fs::write(&path, content)
            .await
            .map(|_| json!({"path": path, "bytes": bytes}))
            .map_err(|e| e.to_string())
    })
}
