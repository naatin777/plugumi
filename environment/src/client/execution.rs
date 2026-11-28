//! running状態のoperation実行がCoreへeventを送るためのhandle。
//! invoke応答で `{status: "running"}` を返したあと、進行・終端は
//! operations.event notificationで送る（contracts/00004）。

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::watch;

use super::rpc::Connection;
use super::wire;

/// session内のrunning executionのcancel配送先。executionIdで照合する。
/// WS切断時はconnectionのclosureが発火するので、こちらは明示cancel専用。
#[derive(Clone, Default)]
pub struct ActiveExecutions {
    senders: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
}

impl ActiveExecutions {
    fn register(&self, execution_id: &str) -> watch::Receiver<bool> {
        let (tx, rx) = watch::channel(false);
        self.senders
            .lock()
            .unwrap()
            .insert(execution_id.to_string(), tx);
        rx
    }

    fn deregister(&self, execution_id: &str) {
        self.senders.lock().unwrap().remove(execution_id);
    }

    /// Coreからのexecutions.cancel notificationを配送する。
    pub fn cancel(&self, execution_id: &str) {
        if let Some(sender) = self.senders.lock().unwrap().get(execution_id) {
            let _ = sender.send(true);
        }
    }
}

pub struct Execution {
    connection: Connection,
    execution_id: String,
    pub operation: String,
    pub input: Value,
    seq: u64,
    closed: watch::Receiver<()>,
    cancel_rx: watch::Receiver<bool>,
    active: ActiveExecutions,
}

impl Execution {
    pub(crate) fn new(
        active: ActiveExecutions,
        connection: Connection,
        execution_id: String,
        operation: String,
        input: Value,
    ) -> Self {
        let closed = connection.closure();
        let cancel_rx = active.register(&execution_id);
        Self {
            connection,
            execution_id,
            operation,
            input,
            seq: 0,
            closed,
            cancel_rx,
            active,
        }
    }

    /// 途中経過を送る。payloadの形はoperationの私物で、
    /// streamSchemaの宣言に対応させるのはplugin側の責任。
    pub fn progress(&mut self, payload: Value) {
        self.event("progress", payload);
    }

    /// 終端のresult eventを送る。これでExecutionはsucceededになる。
    pub fn result(mut self, result: Value) {
        self.event("result", result);
    }

    /// 終端のerror eventを送る。これでExecutionはfailedになる。
    pub fn error(mut self, message: &str) {
        self.event(
            "error",
            json!({"code": "execution_failed", "message": message}),
        );
    }

    /// RPC接続切断のwatch。接続が切れたらCore側でExecutionは
    /// providerDisconnectedとしてfailedになるので、handlerは
    /// これをselectで監視して仕事を止める。
    /// `changed()`が返ったら切断済み。
    pub fn close_watch(&self) -> watch::Receiver<()> {
        self.closed.clone()
    }

    /// Coreからのcancel要求のwatch。handlerはselectで監視し、
    /// 発火したら仕事を止めて `cancel()`で終端eventを送る。
    /// cancelはfalse→trueへ一度だけ遷移するので`changed()`で待てばよい
    /// （`wait_for`の返す`watch::Ref`はSendでなくspawnに載らない）。
    pub fn cancel_watch(&self) -> watch::Receiver<bool> {
        self.cancel_rx.clone()
    }

    /// cancelされて終わったときの終端event。Core側でcancelled statusになる。
    pub fn cancel(mut self) {
        self.event(
            "error",
            json!({"code": "cancelled", "message": "cancelled by caller"}),
        );
    }

    fn event(&mut self, event_type: &str, payload: Value) {
        self.seq += 1;
        self.connection.notify(
            wire::METHOD_OPERATIONS_EVENT,
            json!({
                "executionId": self.execution_id,
                "seq": self.seq,
                "type": event_type,
                "payload": payload,
            }),
        );
    }
}

impl Drop for Execution {
    fn drop(&mut self) {
        self.active.deregister(&self.execution_id);
    }
}

// handlerは終了前に必ずresult/error/cancelのどちらかで終端eventを送る責任を持つ。
// 送らずにdropするとExecutionはCore側でrunningのまま残り、
// 接続切断まで終端に進まない。
