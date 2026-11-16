//! Tool群の宣言と呼出配送。
//! kind（sync/async）に応じて受理・終端の流れが分かれる
//! （docs/contracts/00003）。

mod echo;
mod exec;
mod fs;
mod ticks;

use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::LazyLock;
use tokio::sync::watch;

use crate::rpc::Conn;
use crate::session::Shared;
use crate::wire::{self, CallParams, ToolDecl};

type BoxFut<T> = Pin<Box<dyn Future<Output = T> + Send>>;

pub enum Handler {
    /// 終端がresponseに乗る。実行中の途中出力はCall::outputで流してよい。
    Sync(fn(&mut Call) -> BoxFut<Result<Value, String>>),
    /// 受理({accepted:true})を返してから実処理。Output/ResultはCall経由。
    Async(fn(Call) -> BoxFut<()>),
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

    pub fn result_error(&self, msg: &str) {
        self.conn.notify(
            wire::METHOD_CALL_RESULT,
            serde_json::json!({"callId": self.id,
                "error": {"code": -32000, "message": msg}}),
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

pub(crate) struct ToolDef {
    decl: ToolDecl,
    handler: Handler,
}

fn tools() -> &'static HashMap<String, ToolDef> {
    static TOOLS: LazyLock<HashMap<String, ToolDef>> = LazyLock::new(|| {
        let mut m = HashMap::new();
        for t in [
            echo::def(),
            fs::read_def(),
            fs::write_def(),
            exec::def(),
            ticks::def(),
        ] {
            m.insert(t.decl.tool_path.clone(), t);
        }
        m
    });
    &TOOLS
}

/// tools.set で宣言するTool一覧。
pub fn decls() -> Vec<ToolDecl> {
    tools().values().map(|t| t.decl.clone()).collect()
}

/// 着信 tools.call を捌く。kindに応じて受理・終端を分ける。
pub fn dispatch(shared: Shared, conn: Conn, req_id: Value, params: CallParams) {
    let path = params.tool_path;
    let Some(tool) = tools().get(&path) else {
        conn.respond(
            req_id,
            Err(wire::RpcError {
                code: -32601,
                message: format!("unknown toolPath: {path}"),
                data: None,
            }),
        );
        return;
    };

    let (close_tx, close_rx) = watch::channel(false);
    let call = Call {
        conn: conn.clone(),
        id: req_id.clone(),
        tool_path: path.clone(),
        input: params.input,
        close_rx,
    };
    shared
        .lock()
        .unwrap()
        .calls
        .insert(req_id.to_string(), close_tx);

    match &tool.handler {
        Handler::Sync(f) => {
            let id_key = req_id.to_string();
            tokio::spawn(async move {
                let mut call = call;
                let res = f(&mut call).await;
                let conn = call.conn.clone();
                let id = call.id.clone();
                conn.respond(
                    id,
                    res.map_err(|message| wire::RpcError {
                        code: -32000,
                        message,
                        data: None,
                    }),
                );
                shared.lock().unwrap().calls.remove(&id_key);
            });
        }
        Handler::Async(f) => {
            // 受理を返してから実処理（contracts/00003）。
            conn.respond(req_id.clone(), Ok(serde_json::json!({"accepted": true})));
            let id_key = req_id.to_string();
            tokio::spawn(async move {
                f(call).await;
                shared.lock().unwrap().calls.remove(&id_key);
            });
        }
    }
}

// 各toolの定義ヘルパー。
pub(crate) fn mkdef(path: &str, kind: &str, handler: Handler) -> ToolDef {
    ToolDef {
        decl: ToolDecl {
            tool_path: path.to_string(),
            kind: kind.to_string(),
            description: None,
            tags: None,
        },
        handler,
    }
}

pub(crate) fn boxed<F, T>(f: F) -> BoxFut<T>
where
    F: Future<Output = T> + Send + 'static,
{
    Box::pin(f)
}
