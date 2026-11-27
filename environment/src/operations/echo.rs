//! echo: 入力をそのまま返すoperation（疎通確認用）。

use serde_json::Value;

pub async fn handle(input: &Value) -> Result<Value, String> {
    Ok(input.clone())
}
