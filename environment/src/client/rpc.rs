//! JSON-RPC 2.0 over WebSocket の接続層。
//! request/response のid相関と、相手からのrequest・notificationの配送を担う。
//! 同一connection上で両方向にrequestを飛ばすので、送るidにはprefixを付ける
//! （contracts/00004「id / callId」）。
//!
//! Coreへ接続したWSをattachして使う。

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, oneshot, watch};
use tokio_tungstenite::{tungstenite::Message, WebSocketStream};

use super::wire::{Incoming, Notification, Response, RpcError};

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<Incoming>>>>;

#[derive(Clone)]
pub struct Connection {
    tx: mpsc::UnboundedSender<String>,
    pending: PendingMap,
    seq: Arc<AtomicU64>,
    shutdown: watch::Sender<()>,
}

impl Connection {
    /// Coreへ接続したWSに取り付け、受信pumpを開始する。
    /// `handler` はrequest/notificationを受け取る（responseは内部で相関処理）。
    /// 返り値のJoinHandleはWS接続の切断で終了する。
    pub fn attach<S, F>(ws: WebSocketStream<S>, handler: F) -> (Self, tokio::task::JoinHandle<()>)
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
        F: Fn(Incoming, Connection) + Send + Sync + 'static,
    {
        let (mut sink, mut stream) = ws.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let (shutdown, mut stop_reader) = watch::channel(());
        let mut stop_writer = shutdown.subscribe();
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let connection = Connection {
            tx,
            pending: pending.clone(),
            seq: Arc::new(AtomicU64::new(0)),
            shutdown,
        };

        // writer task
        let writer_shutdown = connection.shutdown.clone();
        tokio::spawn(async move {
            loop {
                // biasedでshutdownを優先確認する。送信中の1フレームは
                // 最後まで送ってから次の周回で止まる（割り込みはしない）。
                let data = tokio::select! {
                    biased;
                    _ = stop_writer.changed() => break,
                    data = rx.recv() => data,
                };
                let Some(data) = data else { break };
                if sink.send(Message::Text(data.into())).await.is_err() {
                    break;
                }
            }
            let _ = writer_shutdown.send(());
        });

        // reader pump
        let read_connection = connection.clone();
        let handle = tokio::spawn(async move {
            loop {
                let frame = tokio::select! {
                    biased;
                    _ = stop_reader.changed() => break,
                    frame = stream.next() => frame,
                };
                let Some(frame) = frame else { break };
                let data = match frame {
                    Ok(Message::Text(data)) => data,
                    Ok(Message::Close(_)) | Err(_) => break,
                    _ => continue,
                };
                let Ok(message) = serde_json::from_str::<Incoming>(&data) else {
                    continue;
                };
                if message.is_response() {
                    if let Some(id) = &message.id {
                        let sender = pending.lock().unwrap().remove(&id.to_string());
                        if let Some(sender) = sender {
                            let _ = sender.send(message);
                        }
                    }
                } else {
                    handler(message, read_connection.clone());
                }
            }
            pending.lock().unwrap().clear();
            read_connection.close();
        });
        (connection, handle)
    }

    pub fn close(&self) {
        let _ = self.shutdown.send(());
    }

    /// 接続切断を検知するためのreceiver。`changed()`が返ったら切断済み。
    /// running状態のoperation handlerが仕事を止める判定に使う。
    pub fn closure(&self) -> watch::Receiver<()> {
        self.shutdown.subscribe()
    }

    // 送るidにはplugin- prefixを付けて受信idと区別する
    // （contracts/00004「id / callId」）。
    fn next_id(&self) -> Value {
        json!(format!(
            "plugin-{}",
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
        response_rx
            .await
            .map_err(|_| "connection closed".to_string())
    }

    /// 受け取ったrequestへのresponseを送る。
    pub fn respond(&self, id: Value, result: Result<Value, RpcError>) {
        let (result, error) = match result {
            Ok(value) => (Some(value), None),
            Err(e) => (None, Some(e)),
        };
        let response = Response {
            jsonrpc: "2.0",
            id,
            result,
            error,
        };
        let _ = self.tx.send(serde_json::to_string(&response).unwrap());
    }

    /// notification を送る。
    pub fn notify(&self, method: &str, params: Value) {
        let notification = Notification {
            jsonrpc: "2.0",
            method: method.to_string(),
            params: Some(params),
        };
        let _ = self.tx.send(serde_json::to_string(&notification).unwrap());
    }

    fn send(&self, value: &Value) -> Result<(), String> {
        self.tx
            .send(value.to_string())
            .map_err(|_| "connection closed".to_string())
    }
}
