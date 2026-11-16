//! Plugin側のLink機構。PluginはCoreを知らず、接続を開始しない。
//! Coreが `GET /v1/transport` でupgradeしてきたWS上で、
//! link.hello応答・tools.set送信・ping・tools.callの配送を行う。
//!
//! LinkはlinkIdごとに独立して管理する。複数のCoreが
//! 同じPluginへ接続してよい（docs/decisionsの複数Core方針）。

use axum::{
    extract::{Request, State, WebSocketUpgrade},
    http::StatusCode,
    response::{Json, Response},
    routing::get,
    Router,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::watch;

use crate::rpc::Conn;
use crate::tools;
use crate::wire::{self, CallParams, HelloRequest, Incoming, PluginInfo};

/// 1つのLinkの状態。Coreが増えてもlinkIdごとに分かれる。
pub struct LinkInner {
    link_id: String,
    /// 再helloの差替え判定に使う不透明な識別子（宛先ではない）。
    core_id: String,
    conn: Conn,
    /// 実行中callのcloseシグナル（callId → close_tx）。
    pub(crate) calls: HashMap<String, watch::Sender<bool>>,
}

pub type SharedLink = Arc<Mutex<LinkInner>>;

/// Plugin全体の状態。Core別のLinkを束ねる。
pub struct PluginState {
    links: HashMap<String, SharedLink>, // linkId →
}

pub type Shared = Arc<Mutex<PluginState>>;

/// Plugin WS serverを立てる（transport upgrade受付のみ。REST operationは持たない）。
pub async fn serve(listen: &str) -> Result<(), String> {
    let shared: Shared = Arc::new(Mutex::new(PluginState {
        links: HashMap::new(),
    }));
    let app = Router::new()
        .route("/v1/transport", get(transport_upgrade))
        .fallback(unsupported_version)
        .with_state(shared);
    let listener = TcpListener::bind(listen).await.map_err(|e| e.to_string())?;
    eprintln!("[standard] listening on {listen}");
    axum::serve(listener, app).await.map_err(|e| e.to_string())
}

// versionはURL prefixで表す（contracts/00001）。
// 知っているversion以外の/vN/はprotocol_mismatchで拒否する。
async fn unsupported_version(req: Request) -> (StatusCode, Json<Value>) {
    let path = req.uri().path();
    let is_other_version = path
        .split('/')
        .nth(1)
        .is_some_and(|seg| seg.starts_with('v') && seg != "v1");
    if is_other_version {
        (
            StatusCode::UPGRADE_REQUIRED,
            Json(json!({"error": {"code": "protocol_mismatch", "message": "unsupported protocol version"}})),
        )
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": {"code": "unknown_endpoint", "message": "unknown endpoint"}})),
        )
    }
}

async fn transport_upgrade(
    ws: WebSocketUpgrade,
    State(shared): State<Shared>,
) -> Response {
    ws.on_upgrade(move |socket| handle_conn(socket, shared))
}

/// 1本のWS接続のライフサイクル。upgrade→hello→tools.set→ping→切断でLink失効。
async fn handle_conn(socket: axum::extract::ws::WebSocket, shared: Shared) {
    // hello成立時にこのconnのLinkが入る。切断時の掃除対象。
    let established: Arc<Mutex<Option<SharedLink>>> = Arc::new(Mutex::new(None));
    let est = established.clone();
    let sh = shared.clone();
    let (_conn, pump) = Conn::attach(socket, move |message, conn| {
        on_message(sh.clone(), est.clone(), message, conn)
    });

    let _ = pump.await;

    // transport切断 = Link失効（contracts/00002）。
    // 差し替え済みのLinkを消さないよう、同じlinkのときだけmapから外す。
    if let Some(link) = established.lock().unwrap().take() {
        teardown_link(&link);
        let link_id = link.lock().unwrap().link_id.clone();
        let mut state = shared.lock().unwrap();
        if let Some(current) = state.links.get(&link_id) {
            if Arc::ptr_eq(current, &link) {
                state.links.remove(&link_id);
            }
        }
    }
    eprintln!("[standard] transport closed");
}

/// transport上のrequest/notification配送。
fn on_message(
    shared: Shared,
    established: Arc<Mutex<Option<SharedLink>>>,
    message: Incoming,
    conn: Conn,
) {
    let Some(method) = message.method.as_deref() else {
        return;
    };
    match method {
        wire::METHOD_LINK_HELLO => {
            let Some(id) = message.id.clone() else { return };
            handle_hello(shared, established, conn, id, message.params);
        }
        wire::METHOD_CALL => {
            let Some(id) = message.id.clone() else { return };
            let Some(link) = established.lock().unwrap().clone() else {
                // Link未確立のconnへのcallは理論上あり得ないが、来たら落とす。
                conn.respond(
                    id,
                    Err(wire::RpcError {
                        code: -32000,
                        message: "link not established".into(),
                        data: None,
                    }),
                );
                return;
            };
            let params: CallParams = match message
                .params
                .clone()
                .and_then(|p| serde_json::from_value(p).ok())
            {
                Some(p) => p,
                None => {
                    conn.respond(
                        id,
                        Err(wire::RpcError {
                            code: -32602,
                            message: "invalid params".into(),
                            data: None,
                        }),
                    );
                    return;
                }
            };
            tools::dispatch(link, conn, id, params);
        }
        wire::METHOD_CALL_CLOSE => {
            let call_id = message
                .params
                .as_ref()
                .and_then(|p| p.get("callId"))
                .cloned();
            if let (Some(call_id), Some(link)) = (call_id, established.lock().unwrap().clone()) {
                if let Some(tx) = link.lock().unwrap().calls.remove(&call_id.to_string()) {
                    let _ = tx.send(true);
                }
            }
        }
        // catalog・その他のCore→Plugin通知は受けるだけ（standardは使わない）。
        _ => {
            if message.is_request() {
                conn.respond(
                    message.id.unwrap(),
                    Err(wire::RpcError {
                        code: -32601,
                        message: "method not found".into(),
                        data: None,
                    }),
                );
            }
        }
    }
}

/// link.hello requestを捌く: 同じcore.idの旧Linkを差し替え、Linkを登録し、
/// plugin情報を応答したあと tools.set・ping loop を起動する。
fn handle_hello(
    shared: Shared,
    established: Arc<Mutex<Option<SharedLink>>>,
    conn: Conn,
    id: Value,
    params: Option<Value>,
) {
    let req: HelloRequest = match params.and_then(|p| serde_json::from_value(p).ok()) {
        Some(r) => r,
        None => {
            conn.respond(
                id,
                Err(wire::RpcError {
                    code: -32602,
                    message: "invalid params".into(),
                    data: None,
                }),
            );
            return;
        }
    };

    // 同じCoreからの再helloは、そのCoreの旧Linkを破棄してから受け入れる
    // （別CoreのLinkは生かす。複数Core接続を許すため）。
    let stale_ids: Vec<String> = {
        let state = shared.lock().unwrap();
        state
            .links
            .iter()
            .filter(|(_, l)| l.lock().unwrap().core_id == req.core.id)
            .map(|(id, _)| id.clone())
            .collect()
    };
    for stale_id in stale_ids {
        if let Some(stale) = shared.lock().unwrap().links.remove(&stale_id) {
            teardown_link(&stale);
        }
    }

    let link: SharedLink = Arc::new(Mutex::new(LinkInner {
        link_id: req.link_id.clone(),
        core_id: req.core.id.clone(),
        conn: conn.clone(),
        calls: HashMap::new(),
    }));
    shared
        .lock()
        .unwrap()
        .links
        .insert(req.link_id.clone(), link.clone());
    *established.lock().unwrap() = Some(link.clone());

    eprintln!(
        "[standard] link established: {} (core {})",
        req.link_id, req.core.id
    );
    conn.respond(
        id,
        Ok(serde_json::to_value(wire::HelloResponse {
            plugin: PluginInfo {
                id: "standard".into(),
                version: Some("0.1.0".into()),
                name: Some("Plugumi Standard Plugin".into()),
            },
        })
        .unwrap()),
    );

    tokio::spawn(start_link(shared, link));
}

/// Linkを破棄する: 実行中callにcloseを送り、送信側を切る。
fn teardown_link(link: &SharedLink) {
    let mut inner = link.lock().unwrap();
    for (_, close_tx) in inner.calls.drain() {
        let _ = close_tx.send(true);
    }
}

/// Link確立後のライフサイクル: tools.set送信 → pingループ。
/// transportが生きている間だけ続く（Linkの寿命 = transportの寿命）。
async fn start_link(shared: Shared, link: SharedLink) {
    let conn = link.lock().unwrap().conn.clone();
    let link_id = link.lock().unwrap().link_id.clone();

    let tools = tools::declarations();
    match tokio::time::timeout(
        Duration::from_secs(5),
        conn.request(
            wire::METHOD_TOOLS_SET,
            serde_json::to_value(wire::ToolsSetRequest { tools }).unwrap(),
        ),
    )
    .await
    {
        Ok(Ok(res)) => eprintln!("[standard] tools.set: {:?}", res.result),
        other => eprintln!("[standard] tools.set failed: {other:?}"),
    }

    // link.pingはtransport上のnotification。Coreが止まった半開きを検出する。
    let mut t = tokio::time::interval(Duration::from_secs(30));
    loop {
        t.tick().await;
        if !shared.lock().unwrap().links.contains_key(&link_id) {
            return;
        }
        conn.notify(wire::METHOD_LINK_PING, json!({}));
    }
}
