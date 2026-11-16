//! Plugin側のSession機構。hello応答・tools.set送信・ping・WS接続・
//! tools.callの配送までをまとめる。PluginはCoreを事前に知らず、
//! helloで受け取った core_url 宛てに以後の送信を行う。
//!
//! SessionはsessionIdごとに独立して管理する — 複数のCoreが
//! 同じPluginへhelloしてよい（docs/decisionsの複数Core方針）。

use axum::{extract::State, http::StatusCode, response::Json, routing::post, Router};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::watch;

use crate::rpc::Conn;
use crate::tools;
use crate::wire::{self, CallParams, HelloRequest, HelloResponse, Incoming, PluginInfo};

const PROTOCOL_VERSION: &str = "0.1.0";

/// 1つのSessionの状態。Coreが増えてもsessionIdごとに分かれる。
pub struct SessionInner {
    session_id: String,
    #[allow(dead_code)]
    registration_id: String,
    core_url: String,
    conn: Option<Conn>,
    /// 実行中callのcloseシグナル（callId → close_tx）。
    pub(crate) calls: HashMap<String, watch::Sender<bool>>,
}

pub type SharedSession = Arc<Mutex<SessionInner>>;

/// Plugin全体の状態。Core別のSessionを束ねる。
pub struct PluginState {
    sessions: HashMap<String, SharedSession>, // sessionId →
}

pub type Shared = Arc<Mutex<PluginState>>;

/// Plugin HTTP serverを立てる（hello受付）。
pub async fn serve(listen: &str) -> Result<(), String> {
    let shared: Shared = Arc::new(Mutex::new(PluginState {
        sessions: HashMap::new(),
    }));
    let app = Router::new()
        .route("/v1/session/hello", post(handle_hello))
        .with_state(shared);
    let listener = TcpListener::bind(listen).await.map_err(|e| e.to_string())?;
    eprintln!("[standard] listening on {listen}");
    axum::serve(listener, app).await.map_err(|e| e.to_string())
}

async fn handle_hello(
    State(shared): State<Shared>,
    Json(req): Json<HelloRequest>,
) -> Result<Json<HelloResponse>, (StatusCode, Json<Value>)> {
    // protocolVersionメジャー不一致は426（contracts/00001）。
    if !req.protocol_version.is_empty()
        && req.protocol_version.split('.').next() != PROTOCOL_VERSION.split('.').next()
    {
        return Err((
            StatusCode::UPGRADE_REQUIRED,
            Json(
                json!({"error": {"code": "protocol_mismatch", "message": "protocolVersion mismatch"}}),
            ),
        ));
    }

    // 同じCoreからの再helloは、そのCoreの旧Sessionを畳んでから受け入れる。
    // （別CoreのSessionは生かす — 複数Core接続を許すため）
    let stale_ids: Vec<String> = {
        let state = shared.lock().unwrap();
        state
            .sessions
            .iter()
            .filter(|(_, s)| s.lock().unwrap().core_url == req.core.url)
            .map(|(id, _)| id.clone())
            .collect()
    };
    for id in stale_ids {
        if let Some(stale) = shared.lock().unwrap().sessions.remove(&id) {
            teardown_session(&stale);
        }
    }

    let session: SharedSession = Arc::new(Mutex::new(SessionInner {
        session_id: req.session_id.clone(),
        registration_id: req.registration_id.clone(),
        core_url: req.core.url.clone(),
        conn: None,
        calls: HashMap::new(),
    }));
    shared
        .lock()
        .unwrap()
        .sessions
        .insert(req.session_id.clone(), session.clone());

    eprintln!(
        "[standard] session established: {} (reg {}, core {})",
        req.session_id, req.registration_id, req.core.url
    );
    tokio::spawn(start_session(shared, session));
    Ok(Json(HelloResponse {
        plugin: PluginInfo {
            id: "standard".into(),
            version: Some("0.1.0".into()),
            name: Some("Plugumi Standard Plugin".into()),
        },
    }))
}

/// Sessionを畳む: 実行中callにcloseを送り、channelを切る。
fn teardown_session(session: &SharedSession) {
    let mut inner = session.lock().unwrap();
    for (_, close_tx) in inner.calls.drain() {
        let _ = close_tx.send(true);
    }
    // connを捨てればwriter taskが終わり、WSも閉じる。
    inner.conn = None;
}

/// Session確立後のライフサイクル: tools.set → pingループ → WS channel。
/// 途中でSessionが畳まれても（Core側の失効・再起動hello）、
/// ping/接続loopはsessions mapを見て終わる。
async fn start_session(shared: Shared, session: SharedSession) {
    let (session_id, core_url) = {
        let inner = session.lock().unwrap();
        (inner.session_id.clone(), inner.core_url.clone())
    };

    // tools.setは短く再試行する — 直列失敗でもsessionを無toolにしない。
    let tools = tools::decls();
    for attempt in 1..=5 {
        if !session_alive(&shared, &session_id) {
            return;
        }
        match http_post_json(
            &format!("{core_url}/v1/tools/set"),
            &wire::ToolsSetRequest {
                session_id: session_id.clone(),
                tools: tools.clone(),
            },
        )
        .await
        {
            Ok(_) => break,
            Err(e) => {
                eprintln!("[standard] tools.set failed (attempt {attempt}): {e}");
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }

    tokio::spawn(ping_loop(
        shared.clone(),
        core_url.clone(),
        session_id.clone(),
    ));
    connect_websocket_loop(shared, session, &session_id).await;
}

/// Sessionがまだ生きているか（mapに残っているか）。
fn session_alive(shared: &Shared, session_id: &str) -> bool {
    shared.lock().unwrap().sessions.contains_key(session_id)
}

async fn ping_loop(shared: Shared, core_url: String, session_id: String) {
    let mut t = tokio::time::interval(Duration::from_secs(30));
    loop {
        t.tick().await;
        if !session_alive(&shared, &session_id) {
            return;
        }
        let _ = http_post_json(
            &format!("{core_url}/v1/session/ping"),
            &wire::PingRequest {
                session_id: session_id.clone(),
            },
        )
        .await;
    }
}

/// WS channelを張り続ける。切断されてもSessionが生きている限り再試行する
/// （channel切断とSession失効は別 — contracts/00002）。
async fn connect_websocket_loop(shared: Shared, session: SharedSession, session_id: &str) {
    loop {
        if !session_alive(&shared, session_id) {
            return;
        }
        match connect_once(shared.clone(), session.clone(), session_id).await {
            Ok(pump) => {
                pump.await.ok();
                session.lock().unwrap().conn = None;
            }
            Err(e) => eprintln!("[standard] ws connect failed: {e}"),
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}

async fn connect_once(
    shared: Shared,
    session: SharedSession,
    session_id: &str,
) -> Result<tokio::task::JoinHandle<()>, String> {
    let core_url = session.lock().unwrap().core_url.clone();
    let url = core_url.replace("http://", "ws://") + "/v1/ws?sessionId=" + session_id;
    let on_msg = {
        let session = session.clone();
        move |message: Incoming, conn: Conn| {
            on_websocket_message(shared.clone(), session.clone(), message, conn)
        }
    };
    let (conn, pump) = Conn::connect(&url, on_msg).await?;
    session.lock().unwrap().conn = Some(conn);
    Ok(pump)
}

/// WS上のrequest/notification配送。
fn on_websocket_message(_shared: Shared, session: SharedSession, message: Incoming, conn: Conn) {
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
            tools::dispatch(session, conn, id, params);
        }
        wire::METHOD_CALL_CLOSE => {
            let call_id = message
                .params
                .as_ref()
                .and_then(|p| p.get("callId"))
                .cloned();
            if let Some(call_id) = call_id {
                if let Some(tx) = session.lock().unwrap().calls.remove(&call_id.to_string()) {
                    let _ = tx.send(true);
                }
            }
        }
        _ => {}
    }
}

/// 最小のHTTP POST（Core→Plugin向け。keep-aliveを切るので body まで読める）。
async fn http_post_json<T: serde::Serialize>(url: &str, body: &T) -> Result<String, String> {
    let stripped = url
        .strip_prefix("http://")
        .ok_or("url must start with http://")?;
    let (host_port, path) = stripped.split_once('/').unwrap_or((stripped, ""));
    let path = format!("/{path}");
    let body_bytes = serde_json::to_vec(body).map_err(|e| e.to_string())?;

    let mut stream = tokio::net::TcpStream::connect(host_port)
        .await
        .map_err(|e| e.to_string())?;
    let head = format!(
        "POST {path} HTTP/1.1\r\nHost: {host_port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body_bytes.len()
    );
    use tokio::io::AsyncWriteExt;
    stream
        .write_all(head.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    stream
        .write_all(&body_bytes)
        .await
        .map_err(|e| e.to_string())?;

    let mut buf = Vec::new();
    use tokio::io::AsyncReadExt;
    stream
        .read_to_end(&mut buf)
        .await
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&buf);
    let status = text.split_whitespace().nth(1).unwrap_or("000");
    if !status.starts_with('2') {
        return Err(format!("POST {url}: status {status}"));
    }
    Ok(text.split("\r\n\r\n").nth(1).unwrap_or("").to_string())
}
