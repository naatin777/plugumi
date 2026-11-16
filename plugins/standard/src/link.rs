//! Plugin側のLink機構。PluginはCoreを知らず、接続を開始しない。
//! 共通規格はREST受付（hello・ping・tools・catalog）、
//! tools.callの流路だけ `GET /v1/transport?linkId=` のWS upgradeを受ける。
//!
//! LinkはlinkIdごとに独立して管理する。複数のCoreが
//! 同じPluginへ接続してよい（docs/decisionsの複数Core方針）。

use axum::{
    extract::{Query, Request, State, WebSocketUpgrade},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;
use tokio::sync::watch;

use crate::rpc::Conn;
use crate::tools;
use crate::wire::{self, CallParams, CatalogRequest, HelloRequest, Incoming, PingRequest};

/// 1つのLinkの状態。Coreが増えてもlinkIdごとに分かれる。
pub struct LinkInner {
    /// 再helloの差替え判定に使う不透明な識別子（宛先ではない）。
    core_id: String,
    conn: Option<Conn>,
    /// 実行中callのcloseシグナル（callId → close_tx）。
    pub(crate) calls: HashMap<String, watch::Sender<bool>>,
    /// Coreがpushしてきた全Tool一覧（standardは使わないが受け取る）。
    #[allow(dead_code)]
    catalog: Vec<wire::ListedTool>,
}

pub type SharedLink = Arc<Mutex<LinkInner>>;

/// Plugin全体の状態。Core別のLinkを束ねる。
pub struct PluginState {
    links: HashMap<String, SharedLink>, // linkId →
}

pub type Shared = Arc<Mutex<PluginState>>;

fn api_error(status: StatusCode, code: &str, message: &str) -> (StatusCode, Json<Value>) {
    (
        status,
        Json(json!({"error": {"code": code, "message": message}})),
    )
}

/// Plugin HTTP serverを立てる（共通規格REST + transport upgrade受付）。
pub async fn serve(listen: &str) -> Result<(), String> {
    let shared: Shared = Arc::new(Mutex::new(PluginState {
        links: HashMap::new(),
    }));
    let app = Router::new()
        .route("/v1/link/hello", post(link_hello))
        .route("/v1/link/ping", post(link_ping))
        .route("/v1/tools", get(list_tools))
        .route("/v1/tools/catalog", post(tools_catalog))
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
        api_error(
            StatusCode::UPGRADE_REQUIRED,
            "protocol_mismatch",
            "unsupported protocol version",
        )
    } else {
        api_error(StatusCode::NOT_FOUND, "unknown_endpoint", "unknown endpoint")
    }
}

/// POST /v1/link/hello: 同じcore.idの旧Linkを差し替え、Linkを登録して
/// plugin情報を返す。transportは別途 `GET /v1/transport` で結ばれる。
async fn link_hello(
    State(shared): State<Shared>,
    body: Result<Json<HelloRequest>, axum::extract::rejection::JsonRejection>,
) -> (StatusCode, Json<Value>) {
    let Ok(Json(req)) = body else {
        return api_error(StatusCode::BAD_REQUEST, "invalid_params", "invalid params");
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
        core_id: req.core.id.clone(),
        conn: None,
        calls: HashMap::new(),
        catalog: Vec::new(),
    }));
    shared
        .lock()
        .unwrap()
        .links
        .insert(req.link_id.clone(), link);

    eprintln!(
        "[standard] link established: {} (core {})",
        req.link_id, req.core.id
    );
    (
        StatusCode::OK,
        Json(serde_json::to_value(wire::HelloResponse {
            plugin: wire::PluginInfo {
                id: "standard".into(),
                version: Some("0.1.0".into()),
                name: Some("Plugumi Standard Plugin".into()),
            },
        })
        .unwrap()),
    )
}

/// POST /v1/link/ping: Core→Pluginの生存確認probe。
/// 現存するlinkIdなら200、失効済み・不明なら404 unknown_link。
async fn link_ping(
    State(shared): State<Shared>,
    body: Result<Json<PingRequest>, axum::extract::rejection::JsonRejection>,
) -> (StatusCode, Json<Value>) {
    let Ok(Json(req)) = body else {
        return api_error(StatusCode::BAD_REQUEST, "invalid_params", "invalid params");
    };
    if shared.lock().unwrap().links.contains_key(&req.link_id) {
        (StatusCode::OK, Json(json!({})))
    } else {
        api_error(StatusCode::NOT_FOUND, "unknown_link", "no such linkId")
    }
}

/// GET /v1/tools: このPluginのTool宣言を返す（Coreがpullする）。
async fn list_tools() -> (StatusCode, Json<Value>) {
    (
        StatusCode::OK,
        Json(json!({ "tools": tools::declarations() })),
    )
}

/// POST /v1/tools/catalog: Coreからの全Tool一覧pushを受け取る。
/// 宛先Linkが不明なら404 unknown_link。
async fn tools_catalog(
    State(shared): State<Shared>,
    body: Result<Json<CatalogRequest>, axum::extract::rejection::JsonRejection>,
) -> (StatusCode, Json<Value>) {
    let Ok(Json(req)) = body else {
        return api_error(StatusCode::BAD_REQUEST, "invalid_params", "invalid params");
    };
    let state = shared.lock().unwrap();
    let Some(link) = state.links.get(&req.link_id) else {
        return api_error(StatusCode::NOT_FOUND, "unknown_link", "no such linkId");
    };
    link.lock().unwrap().catalog = req.tools;
    (StatusCode::OK, Json(json!({})))
}

/// GET /v1/transport?linkId=: tools.call用WSのupgrade受付。
/// 現存するLinkにだけtransportを結ぶ。
async fn transport_upgrade(
    ws: WebSocketUpgrade,
    State(shared): State<Shared>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let Some(link_id) = query.get("linkId") else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": {"code": "invalid_params", "message": "linkId required"}})),
        )
            .into_response();
    };
    let link = {
        let state = shared.lock().unwrap();
        state.links.get(link_id).cloned()
    };
    let Some(link) = link else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error": {"code": "unknown_link", "message": "no such linkId"}})),
        )
            .into_response();
    };
    ws.on_upgrade(move |socket| handle_conn(socket, shared, link))
}

/// 1本のtransport（WS）のライフサイクル。upgrade→tools.call配送→切断でLink失効。
async fn handle_conn(socket: axum::extract::ws::WebSocket, shared: Shared, link: SharedLink) {
    let conn_link = link.clone();
    let (conn, pump) = Conn::attach(socket, move |message, conn| {
        on_message(conn_link.clone(), message, conn)
    });
    link.lock().unwrap().conn = Some(conn);

    let _ = pump.await;

    // transport切断 = Link失効（contracts/00002）。
    // 差し替え済みのLinkを消さないよう、同じlinkのときだけmapから外す。
    teardown_link(&link);
    let mut state = shared.lock().unwrap();
    state.links.retain(|_, current| !Arc::ptr_eq(current, &link));
    eprintln!("[standard] transport closed");
}

/// transport上のrequest/notification配送。共通規格はRESTで行うため、
/// ここに届くのはtools.call系のみ。
fn on_message(link: SharedLink, message: Incoming, conn: Conn) {
    let Some(method) = message.method.as_deref() else {
        return;
    };
    match method {
        wire::METHOD_CALL => {
            let Some(id) = message.id.clone() else { return };
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
            if let Some(call_id) = call_id {
                if let Some(tx) = link.lock().unwrap().calls.remove(&call_id.to_string()) {
                    let _ = tx.send(true);
                }
            }
        }
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

/// Linkを破棄する: 実行中callにcloseを送る。
fn teardown_link(link: &SharedLink) {
    let mut inner = link.lock().unwrap();
    for (_, close_tx) in inner.calls.drain() {
        let _ = close_tx.send(true);
    }
}
