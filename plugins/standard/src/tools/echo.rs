//! echo — 入力をそのまま返すsync tool（疎通確認用）。

use super::{boxed, mkdef, Call, Handler, ToolDef};

pub(super) fn def() -> ToolDef {
    mkdef("echo", "sync", Handler::Sync(handle))
}

fn handle(call: &mut Call) -> super::BoxFut<Result<serde_json::Value, String>> {
    let input = call.input.clone();
    boxed(async move { Ok(input) })
}
