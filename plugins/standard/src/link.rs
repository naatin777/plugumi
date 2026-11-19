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

use crate::rpc::Connection;
use crate::tools;
use crate::wire::{
    self, ForwardCallParams, HelloRequest, Incoming, PingRequest, ToolsCatalogRequest,
};

/// 1つのLinkの状態。Coreが増えてもlinkIdごとに分かれる。
pub struct LinkState {
    /// 再helloの差替え判定に使う不透明な識別子（宛先ではない）。
    core_id: String,
    transport: Option<Connection>,
    /// 実行中callのcloseシグナル（callId → close sender）。
    pub(crate) calls: HashMap<String, watch::Sender<bool>>,
    /// Coreがpushしてきた全Tool一覧（standardは使わないが受け取る）。
    #[allow(dead_code)]
    catalog: Vec<wire::ListedTool>,
}

pub type SharedLink = Arc<Mutex<LinkState>>;

/// Plugin全体の状態。Core別のLinkを束ねる。
pub struct PluginState {
    links: HashMap<String, SharedLink>, // linkId →
}

pub type SharedPlugin = Arc<Mutex<PluginState>>;

fn api_error(status: StatusCode, code: &str, message: &str) -> (StatusCode, Json<Value>) {
    (
        status,
        Json(json!({"error": {"code": code, "message": message}})),
    )
}

/// Plugin HTTP serverを立てる（共通規格REST + transport upgrade受付）。
pub async fn serve(listen: &str) -> Result<(), String> {
    let shared: SharedPlugin = Arc::new(Mutex::new(PluginState {
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
    let address = listener.local_addr().map_err(|e| e.to_string())?;
    eprintln!("[standard] listening on http://{address}");
    axum::serve(listener, app).await.map_err(|e| e.to_string())
}

// versionはURL prefixで表す（contracts/00001）。
// 知っているversion以外の/vN/はprotocol_mismatchで拒否する。
async fn unsupported_version(req: Request) -> (StatusCode, Json<Value>) {
    let path = req.uri().path();
    // /vN/（Nは数字）だけがversion付きpath。/vX/のような数字でない
    // prefixは未知path扱いで404（contracts/00001）。
    let is_other_version = path.split('/').nth(1).is_some_and(|seg| {
        seg != "v1"
            && seg.starts_with('v')
            && seg.len() > 1
            && seg[1..].chars().all(|c| c.is_ascii_digit())
    });
    if is_other_version {
        api_error(
            StatusCode::UPGRADE_REQUIRED,
            "protocol_mismatch",
            "unsupported protocol version",
        )
    } else {
        api_error(
            StatusCode::NOT_FOUND,
            "unknown_endpoint",
            "unknown endpoint",
        )
    }
}

/// POST /v1/link/hello: 同じcore.idの旧Linkを差し替え、Linkを登録して
/// plugin情報を返す。transportは別途 `GET /v1/transport` で結ばれる。
async fn link_hello(
    State(shared): State<SharedPlugin>,
    body: Result<Json<HelloRequest>, axum::extract::rejection::JsonRejection>,
) -> (StatusCode, Json<Value>) {
    let Ok(Json(req)) = body else {
        return api_error(StatusCode::BAD_REQUEST, "invalid_params", "invalid params");
    };

    // 同じCoreからの再helloは、そのCoreの旧Linkを破棄してから受け入れる
    // （別CoreのLinkは生かす。複数Core接続を許すため）。
    let link: SharedLink = Arc::new(Mutex::new(LinkState {
        core_id: req.core.id.clone(),
        transport: None,
        calls: HashMap::new(),
        catalog: Vec::new(),
    }));
    {
        let mut state = shared.lock().unwrap();
        state.links.retain(|id, existing| {
            if *id == req.link_id || existing.lock().unwrap().core_id == req.core.id {
                teardown_link(existing);
                return false;
            }
            true
        });
        state.links.insert(req.link_id.clone(), link);
    }

    eprintln!(
        "[standard] link established: {} (core {})",
        req.link_id, req.core.id
    );
    (
        StatusCode::OK,
        Json(json!({"plugin": {
            "id": "standard",
            "version": "0.1.0",
            "name": "Plugumi Standard Plugin",
        }})),
    )
}

/// POST /v1/link/ping: Core→Pluginの生存確認probe。
/// 現存するlinkIdなら200、失効済み・不明なら404 unknown_link。
async fn link_ping(
    State(shared): State<SharedPlugin>,
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
    State(shared): State<SharedPlugin>,
    body: Result<Json<ToolsCatalogRequest>, axum::extract::rejection::JsonRejection>,
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
    State(shared): State<SharedPlugin>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let Some(link_id) = query.get("linkId") else {
        return api_error(StatusCode::BAD_REQUEST, "invalid_params", "linkId required")
            .into_response();
    };
    let link = {
        let state = shared.lock().unwrap();
        state.links.get(link_id).cloned()
    };
    let Some(link) = link else {
        return api_error(StatusCode::NOT_FOUND, "unknown_link", "no such linkId").into_response();
    };
    let link_id = link_id.clone();
    ws.on_upgrade(move |socket| handle_transport(socket, shared, link_id, link))
}

/// 1本のtransport（WS）のライフサイクル。upgrade→tools.call配送→切断でLink失効。
async fn handle_transport(
    socket: axum::extract::ws::WebSocket,
    shared: SharedPlugin,
    link_id: String,
    link: SharedLink,
) {
    let pump = {
        let state = shared.lock().unwrap();
        if !state
            .links
            .get(&link_id)
            .is_some_and(|current| Arc::ptr_eq(current, &link))
        {
            return;
        }
        let mut inner = link.lock().unwrap();
        if inner.transport.is_some() {
            return;
        }
        let handler_link = link.clone();
        let (connection, pump) = Connection::attach(socket, move |message, connection| {
            on_message(handler_link.clone(), message, connection)
        });
        inner.transport = Some(connection);
        pump
    };

    let _ = pump.await;

    // transport切断 = Link失効（contracts/00002）。
    // 差し替え済みのLinkを消さないよう、同じlinkのときだけmapから外す。
    {
        let mut state = shared.lock().unwrap();
        if state
            .links
            .get(&link_id)
            .is_some_and(|current| Arc::ptr_eq(current, &link))
        {
            state.links.remove(&link_id);
        }
    }
    teardown_link(&link);
    eprintln!("[standard] transport closed");
}

/// transport上のrequest/notification配送。共通規格はRESTで行うため、
/// ここに届くのはtools.call系のみ。
fn on_message(link: SharedLink, message: Incoming, connection: Connection) {
    let Some(method) = message.method.as_deref() else {
        return;
    };
    match method {
        wire::METHOD_CALL => {
            let Some(id) = message.id.clone() else { return };
            let params: ForwardCallParams = match message
                .params
                .and_then(|params| serde_json::from_value(params).ok())
            {
                Some(params) => params,
                None => {
                    connection.respond(
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
            tools::dispatch(link, connection, id, params);
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
                connection.respond(
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

/// Linkを破棄し、transportと実行中callを閉じる（contracts/00001・00002）。
fn teardown_link(link: &SharedLink) {
    let mut inner = link.lock().unwrap();
    if let Some(connection) = inner.transport.take() {
        connection.close();
    }
    for (_, close_tx) in inner.calls.drain() {
        let _ = close_tx.send(true);
    }
}
