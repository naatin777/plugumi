//! echo: 入力をそのまま返すsync tool（疎通確認用）。

use super::ToolCall;
use serde_json::Value;

pub async fn handle(call: &mut ToolCall) -> Result<Value, String> {
    Ok(call.input.clone())
}
