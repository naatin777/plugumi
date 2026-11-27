//! running状態のoperation実行がCoreへeventを送るためのhandle。
//! invoke応答で `{status: "running"}` を返したあと、進行・終端は
//! operations.event notificationで送る（contracts/00004）。

use serde_json::{json, Value};
use tokio::sync::watch;

use super::rpc::Connection;
use super::wire;

pub struct Execution {
    connection: Connection,
    execution_id: String,
    pub operation: String,
    pub input: Value,
    seq: u64,
    closed: watch::Receiver<()>,
}

impl Execution {
    pub(crate) fn new(
        connection: Connection,
        execution_id: String,
        operation: String,
        input: Value,
    ) -> Self {
        let closed = connection.closure();
        Self {
            connection,
            execution_id,
            operation,
            input,
            seq: 0,
            closed,
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

    /// RPC接続の切断を待つ。接続が切れたらCore側でExecutionは
    /// providerDisconnectedとしてfailedになるので、handlerは
    /// これを検知して仕事を止める。
    pub async fn disconnected(&mut self) {
        let _ = self.closed.changed().await;
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

// handlerは終了前に必ずresult/errorのどちらかで終端eventを送る責任を持つ。
// 送らずにdropするとExecutionはCore側でrunningのまま残り、
// 接続切断まで終端に進まない。
