//! Tool群の宣言と呼び出し配送。
//!
//! 各toolは対応するmoduleの `async fn` として実装する。
//! `kind`（sync/async）で受理・終端の流れが分かれる（docs/contracts/00004）:
//!
//! - sync: handlerの戻り値が呼び出しのresponseになる
//! - async: 受理 `{accepted:true}` を返してから実処理し、
//!   途中出力・終端は `ToolCall` 経由のnotificationで送る

mod echo;
mod exec;
mod fs;
mod ticks;

use serde_json::Value;
use tokio::sync::watch;

use crate::core_client::SharedCalls;
use crate::rpc::Connection;
use crate::wire::{self, ForwardCallParams, ToolDeclaration};

/// 登録するTool一覧。`toolPath` と `kind` のみを持ち、
/// handlerの選択は `dispatch` のmatchで行う（片方だけ更新しないこと）。
const TOOLS: &[(&str, &str)] = &[
    ("echo", "sync"),
    ("fs/read", "sync"),
    ("fs/write", "sync"),
    ("exec", "async"),
    ("ticks", "async"),
];

/// Coreへ登録するTool宣言一覧（contracts/00004）。
pub fn declarations() -> Vec<ToolDeclaration> {
    TOOLS
        .iter()
        .map(|&(path, kind)| ToolDeclaration {
            tool_path: path.to_string(),
            kind: kind.to_string(),
            description: None,
            tags: None,
        })
        .collect()
}

/// 1つの着信呼び出し。ToolPath・Inputのほか、async側では
/// output/result/closed を使う。
pub struct ToolCall {
    pub connection: Connection,
    pub id: Value, // callId = 呼び出しrequestのJSON-RPC id
    pub tool_path: String,
    pub input: Value,
    close_rx: watch::Receiver<bool>,
}

impl ToolCall {
    /// 途中出力 notification を送る。
    pub fn chunk(&self, payload: Value) {
        self.connection.notify(
            wire::METHOD_CALL_CHUNK,
            serde_json::json!({"callId": self.id, "payload": payload}),
        );
    }

    /// async呼び出しの終端 result notification を送る。
    pub fn result(&self, result: Value) {
        self.connection.notify(
            wire::METHOD_CALL_RESULT,
            serde_json::json!({"callId": self.id, "result": result}),
        );
    }

    pub fn result_error(&self, message: &str) {
        self.connection.notify(
            wire::METHOD_CALL_RESULT,
            serde_json::json!({"callId": self.id,
                "error": {"code": -32000, "message": message}}),
        );
    }

    /// 呼び出し元のclose（またはRPC接続終了）を待つ。購読系toolはこれで終わる。
    pub async fn closed(&mut self) {
        // senderがdropされても返る（接続の後始末）。
        let _ = self.close_rx.wait_for(|closed| *closed).await;
    }
}

/// 着信 tools.call を捌く。callIdでclose配送できるよう登録し、
/// kindに応じて受理・終端を分ける。
pub fn dispatch(
    calls: SharedCalls,
    connection: Connection,
    req_id: Value,
    params: ForwardCallParams,
) {
    let (close_tx, close_rx) = watch::channel(false);
    let call = ToolCall {
        connection: connection.clone(),
        id: req_id.clone(),
        tool_path: params.tool_path.clone(),
        input: params.input,
        close_rx,
    };
    calls
        .lock()
        .unwrap()
        .call_close_senders
        .insert(req_id.to_string(), close_tx);

    match params.tool_path.as_str() {
        // sync: handlerの戻り値が呼び出しのresponseになる。
        "echo" | "fs/read" | "fs/write" => {
            let call_key = req_id.to_string();
            tokio::spawn(async move {
                let mut call = call;
                let res = match call.tool_path.as_str() {
                    "echo" => echo::handle(&mut call).await,
                    "fs/read" => fs::read(&mut call).await,
                    _ => fs::write(&mut call).await,
                };
                call.connection.respond(
                    call.id.clone(),
                    res.map_err(|message| wire::RpcError {
                        code: -32000,
                        message,
                        data: None,
                    }),
                );
                calls.lock().unwrap().call_close_senders.remove(&call_key);
            });
        }

        // async: 受理({accepted:true})を返してから実処理。
        "exec" | "ticks" => {
            connection.respond(req_id.clone(), Ok(serde_json::json!({"accepted": true})));
            let call_key = req_id.to_string();
            tokio::spawn(async move {
                match call.tool_path.as_str() {
                    "exec" => exec::handle(call).await,
                    _ => ticks::handle(call).await,
                }
                calls.lock().unwrap().call_close_senders.remove(&call_key);
            });
        }

        // 未知toolPathではclose sender登録を残さない（close配送対象がないのに
        // mapへ残るとリークする）。
        _ => {
            calls
                .lock()
                .unwrap()
                .call_close_senders
                .remove(&req_id.to_string());
            connection.respond(
                req_id,
                Err(wire::RpcError {
                    code: -32601,
                    message: format!("unknown toolPath: {}", params.tool_path),
                    data: None,
                }),
            )
        }
    }
}
