//! Tool群の宣言と呼出配送。
//!
//! 各toolは対応するmoduleの `async fn` として実装する。
//! `kind`（sync/async）で受理・終端の流れが分かれる（docs/contracts/00003）:
//!
//! - sync: handlerの戻り値が呼出のresponseになる
//! - async: 受理 `{accepted:true}` を返してから実処理し、
//!   途中出力・終端は `Call` 経由のnotificationで送る

mod echo;
mod exec;
mod fs;
mod ticks;

use serde_json::Value;
use tokio::sync::watch;

use crate::rpc::Conn;
use crate::session::Shared;
use crate::wire::{self, CallParams, ToolDecl};

/// 登録するTool一覧。`toolPath` と `kind` のみを持ち、
/// handlerの選択は `dispatch` のmatchで行う（片方だけ更新しないこと）。
const TOOLS: &[(&str, &str)] = &[
    ("echo", "sync"),
    ("fs/read", "sync"),
    ("fs/write", "sync"),
    ("exec", "async"),
    ("ticks", "async"),
];

/// tools.set で宣言するTool一覧。
pub fn decls() -> Vec<ToolDecl> {
    TOOLS
        .iter()
        .map(|&(path, kind)| ToolDecl {
            tool_path: path.to_string(),
            kind: kind.to_string(),
            description: None,
            tags: None,
        })
        .collect()
}

/// 1つの着信呼出。ToolPath・Inputのほか、async側では
/// output/result/closed を使う。
pub struct Call {
    pub conn: Conn,
    pub id: Value, // callId = 呼出requestのJSON-RPC id
    pub tool_path: String,
    pub input: Value,
    close_rx: watch::Receiver<bool>,
}

impl Call {
    /// 途中出力 notification を送る。
    pub fn output(&self, payload: Value) {
        self.conn.notify(
            wire::METHOD_CALL_OUTPUT,
            serde_json::json!({"callId": self.id, "payload": payload}),
        );
    }

    /// async呼出の終端 result notification を送る。
    pub fn result(&self, result: Value) {
        self.conn.notify(
            wire::METHOD_CALL_RESULT,
            serde_json::json!({"callId": self.id, "result": result}),
        );
    }

    pub fn result_error(&self, message: &str) {
        self.conn.notify(
            wire::METHOD_CALL_RESULT,
            serde_json::json!({"callId": self.id,
                "error": {"code": -32000, "message": message}}),
        );
    }

    /// 呼出元のclose（またはSession終了）を待つ。購読系toolはこれで終わる。
    pub async fn closed(&mut self) {
        while !*self.close_rx.borrow() {
            if self.close_rx.changed().await.is_err() {
                return;
            }
        }
    }
}

/// 着信 tools.call を捌く。callIdでclose配送できるよう登録し、
/// kindに応じて受理・終端を分ける。
pub fn dispatch(shared: Shared, conn: Conn, req_id: Value, params: CallParams) {
    let (close_tx, close_rx) = watch::channel(false);
    let call = Call {
        conn: conn.clone(),
        id: req_id.clone(),
        tool_path: params.tool_path.clone(),
        input: params.input,
        close_rx,
    };
    shared
        .lock()
        .unwrap()
        .calls
        .insert(req_id.to_string(), close_tx);

    match params.tool_path.as_str() {
        // sync: handlerの戻り値が呼出のresponseになる。
        "echo" | "fs/read" | "fs/write" => {
            let id_key = req_id.to_string();
            tokio::spawn(async move {
                let mut call = call;
                let res = match call.tool_path.as_str() {
                    "echo" => echo::handle(&mut call).await,
                    "fs/read" => fs::read(&mut call).await,
                    _ => fs::write(&mut call).await,
                };
                call.conn.respond(
                    call.id.clone(),
                    res.map_err(|message| wire::RpcError {
                        code: -32000,
                        message,
                        data: None,
                    }),
                );
                shared.lock().unwrap().calls.remove(&id_key);
            });
        }

        // async: 受理({accepted:true})を返してから実処理。
        "exec" | "ticks" => {
            conn.respond(req_id.clone(), Ok(serde_json::json!({"accepted": true})));
            let id_key = req_id.to_string();
            tokio::spawn(async move {
                match call.tool_path.as_str() {
                    "exec" => exec::handle(call).await,
                    _ => ticks::handle(call).await,
                }
                shared.lock().unwrap().calls.remove(&id_key);
            });
        }

        _ => conn.respond(
            req_id,
            Err(wire::RpcError {
                code: -32601,
                message: format!("unknown toolPath: {}", params.tool_path),
                data: None,
            }),
        ),
    }
}
