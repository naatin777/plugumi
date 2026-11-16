//! JSON-RPC 2.0 over WebSocket の接続層。
//! request/response のid相関と、相手からのrequest・notificationの配送を担う。
//! 同一conn上で両方向にrequestを飛ばすので、送るidにはprefixを付ける
//! （docs/contracts/00003「idの一意性」）。
//!
//! Pluginは接続を開始しない。CoreがupgradeしたWSをattachして使う。

use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, oneshot};

use crate::wire::{Incoming, Notification, Response, RpcError};

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<Incoming>>>>;

#[derive(Clone)]
pub struct Conn {
    tx: mpsc::UnboundedSender<String>,
    pending: PendingMap,
    seq: Arc<AtomicU64>,
    prefix: String,
}

impl Conn {
    /// CoreがupgradeしたWSに取り付け、受信pumpを開始する。
    /// `handler` はrequest/notificationを受け取る（responseは内部で相関処理）。
    /// 返り値のJoinHandleはtransport切断で終了する。
    pub fn attach<F>(ws: WebSocket, handler: F) -> (Self, tokio::task::JoinHandle<()>)
    where
        F: Fn(Incoming, Conn) + Send + Sync + 'static,
    {
        let (mut sink, mut stream) = ws.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let conn = Conn {
            tx,
            pending: pending.clone(),
            seq: Arc::new(AtomicU64::new(0)),
            prefix: "plugin-".into(),
        };

        // writer task
        tokio::spawn(async move {
            while let Some(data) = rx.recv().await {
                if sink.send(Message::Text(data.into())).await.is_err() {
                    return;
                }
            }
        });

        // reader pump
        let read_conn = conn.clone();
        let handle = tokio::spawn(async move {
            while let Some(frame) = stream.next().await {
                let Ok(Message::Text(data)) = frame else {
                    continue;
                };
                let Ok(message) = serde_json::from_str::<Incoming>(&data) else {
                    continue;
                };
                if message.is_response() {
                    if let Some(id) = &message.id {
                        let ch = pending.lock().unwrap().remove(&id.to_string());
                        if let Some(ch) = ch {
                            let _ = ch.send(message);
                        }
                    }
                } else {
                    handler(message, read_conn.clone());
                }
            }
        });
        (conn, handle)
    }

    fn next_id(&self) -> Value {
        json!(format!(
            "{}{}",
            self.prefix,
            self.seq.fetch_add(1, Ordering::SeqCst) + 1
        ))
    }

    /// request を送り、responseを待つ。
    pub async fn request(&self, method: &str, params: Value) -> Result<Incoming, String> {
        let id = self.next_id();
        let (response_tx, response_rx) = oneshot::channel();
        self.pending
            .lock()
            .unwrap()
            .insert(id.to_string(), response_tx);
        self.send(&json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}))?;
        response_rx.await.map_err(|_| "conn closed".to_string())
    }

    /// 受け取ったrequestへのresponseを送る。
    pub fn respond(&self, id: Value, result: Result<Value, RpcError>) {
        let res = match result {
            Ok(v) => Response {
                jsonrpc: "2.0",
                id,
                result: Some(v),
                error: None,
            },
            Err(e) => Response {
                jsonrpc: "2.0",
                id,
                result: None,
                error: Some(e),
            },
        };
        let _ = self.tx.send(serde_json::to_string(&res).unwrap());
    }

    /// notification を送る。
    pub fn notify(&self, method: &str, params: Value) {
        let n = Notification {
            jsonrpc: "2.0",
            method: method.to_string(),
            params: Some(params),
        };
        let _ = self.tx.send(serde_json::to_string(&n).unwrap());
    }

    fn send(&self, v: &Value) -> Result<(), String> {
        self.tx
            .send(v.to_string())
            .map_err(|_| "conn closed".to_string())
    }
}
