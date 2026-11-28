//! operation群の宣言と呼び出し配送。
//!
//! 各operationは対応するmoduleで実装する。実行の形は2つ（contracts/00004）:
//!
//! - terminal応答: handlerの結果をinvoke応答で直接返す
//!   （echo / filesystem系。短時間で終わるもの）
//! - running応答: `{status: "running"}` を返してから実処理し、
//!   進行・終端は `Execution` 経由のoperations.eventで送る
//!   （shell/exec / dev/ticks。長時間・streamのあるもの）

mod dev;
mod echo;
mod filesystem;
mod shell;

use serde_json::{json, Value};

use crate::client::execution::{ActiveExecutions, Execution};
use crate::client::rpc::Connection;
use crate::client::wire::{self, ForwardInvokeParams};

/// Coreへ登録するoperation宣言一覧（contracts/00004）。
/// operationを追加するときは `dispatch` のmatchにもhandlerを追加する。
/// ここにだけ書くと宣言済みの呼び出しがunknownで失敗し、
/// dispatchにだけ書くとCoreから呼び出しが届かない。
pub fn declarations() -> Vec<Value> {
    vec![
        json!({
            "path": "echo",
            "description": "入力をそのまま返す。疎通確認用。",
        }),
        json!({
            "path": "filesystem/list",
            "description": "ディレクトリのentries一覧を返す。",
            "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}},
        }),
        json!({
            "path": "filesystem/read",
            "description": "ファイルを読んで内容を返す。",
            "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
        }),
        json!({
            "path": "filesystem/write",
            "description": "ファイルへ内容を書き込む。",
            "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}, "required": ["path", "content"]},
        }),
        json!({
            "path": "shell/exec",
            "description": "コマンドを実行し、stdout/stderrを進行として流す。",
            "inputSchema": {"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"]},
        }),
        json!({
            "path": "dev/ticks",
            "description": "一定間隔でtickを進行として流す検証用operation。",
            "inputSchema": {"type": "object", "properties": {"intervalMs": {"type": "integer"}, "count": {"type": "integer"}}},
        }),
    ]
}

/// 着信operations.invokeを捌く。
pub fn dispatch(
    active: ActiveExecutions,
    connection: Connection,
    req_id: Value,
    params: ForwardInvokeParams,
) {
    let operation = params.operation.clone();
    let execution = Execution::new(
        active,
        connection.clone(),
        params.execution_id,
        params.operation,
        params.input,
    );
    match operation.as_str() {
        // terminal応答: handlerの結果をinvoke応答で直接返す。
        "echo" | "filesystem/list" | "filesystem/read" | "filesystem/write" => {
            tokio::spawn(async move {
                let result = match operation.as_str() {
                    "echo" => echo::handle(&execution.input).await,
                    "filesystem/list" => filesystem::list(&execution.input).await,
                    "filesystem/read" => filesystem::read(&execution.input).await,
                    _ => filesystem::write(&execution.input).await,
                };
                connection.respond(
                    req_id,
                    Ok(match result {
                        Ok(result) => json!({"status": "succeeded", "result": result}),
                        Err(message) => json!({
                            "status": "failed",
                            "error": {"code": "execution_failed", "message": message},
                        }),
                    }),
                );
            });
        }

        // running応答: {status: "running"}を返してから実処理。
        // 進行・終端はExecution経由のoperations.eventで送る。
        "shell/exec" | "dev/ticks" => {
            connection.respond(req_id, Ok(json!({"status": "running"})));
            tokio::spawn(async move {
                match operation.as_str() {
                    "shell/exec" => shell::handle(execution).await,
                    _ => dev::ticks(execution).await,
                }
            });
        }

        _ => connection.respond(
            req_id,
            Err(wire::RpcError {
                code: -32601,
                message: format!("unknown operation: {operation}"),
                data: None,
            }),
        ),
    }
}
