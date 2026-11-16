//! Plugin側のSession機構。hello応答・tools.set送信・ping・WS接続・
//! tools.callの配送までをまとめる。PluginはCoreを事前に知らず、
//! helloで受け取った core_url 宛てに以後の送信を行う。

use axum::{extract::State, http::StatusCode, response::Json, routing::post, Router};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::watch;

use crate::rpc::Conn;
use crate::tools;
use crate::wire::{self, CallParams, HelloRequest, HelloResponse, Incoming, PluginInfo};

const PROTOCOL_VERSION: &str = "0.1.0";

pub struct PluginState {
    session_id: String,
    registration_id: String,
    core_url: String,
    conn: Option<Conn>,
    /// 実行中callのcloseシグナル（callId → close_tx）。
    pub(crate) calls: HashMap<String, watch::Sender<bool>>,
}

pub type Shared = Arc<Mutex<PluginState>>;

/// Plugin HTTP serverを立てる（hello受付）。
pub async fn serve(listen: &str) -> Result<(), String> {
    let shared: Shared = Arc::new(Mutex::new(PluginState {
        session_id: String::new(),
        registration_id: String::new(),
        core_url: String::new(),
        conn: None,
        calls: HashMap::new(),
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
    {
        let mut st = shared.lock().unwrap();
        st.session_id = req.session_id.clone();
        st.registration_id = req.registration_id.clone();
        st.core_url = req.core.url.clone();
    }
    eprintln!(
        "[standard] session established: {} (reg {}, core {})",
        req.session_id, req.registration_id, req.core.url
    );
    tokio::spawn(start_session(shared));
    Ok(Json(HelloResponse {
        plugin: PluginInfo {
            id: "standard".into(),
            version: Some("0.1.0".into()),
            name: Some("Plugumi Standard Plugin".into()),
        },
    }))
}

/// Session確立後のライフサイクル: tools.set → pingループ → WS channel。
async fn start_session(shared: Shared) {
    let (core_url, session_id) = {
        let st = shared.lock().unwrap();
        (st.core_url.clone(), st.session_id.clone())
    };
    let tools = tools::decls();
    if let Err(e) = http_post_json(
        &format!("{core_url}/v1/tools/set"),
        &wire::ToolsSetRequest {
            session_id: session_id.clone(),
            tools,
        },
    )
    .await
    {
        eprintln!("[standard] tools.set failed: {e}");
    }
    tokio::spawn(ping_loop(core_url.clone(), session_id.clone()));
    if let Err(e) = connect_ws(shared, &core_url, &session_id).await {
        eprintln!("[standard] ws connect failed: {e}");
    }
}

async fn ping_loop(core_url: String, session_id: String) {
    let mut t = tokio::time::interval(Duration::from_secs(30));
    loop {
        t.tick().await;
        let _ = http_post_json(
            &format!("{core_url}/v1/session/ping"),
            &wire::PingRequest {
                session_id: session_id.clone(),
            },
        )
        .await;
    }
}

async fn connect_ws(shared: Shared, core_url: &str, session_id: &str) -> Result<(), String> {
    let url = core_url.replace("http://", "ws://") + "/v1/ws?sessionId=" + session_id;
    let on_msg = {
        let shared = shared.clone();
        move |in_msg: Incoming, conn: Conn| on_ws_message(shared.clone(), in_msg, conn)
    };
    let (conn, _pump) = Conn::connect(&url, on_msg).await?;
    shared.lock().unwrap().conn = Some(conn);
    _pump.await.ok();
    Ok(())
}

/// WS上のrequest/notification配送。
fn on_ws_message(shared: Shared, in_msg: Incoming, conn: Conn) {
    let Some(method) = in_msg.method.as_deref() else {
        return;
    };
    match method {
        wire::METHOD_CALL => {
            let Some(id) = in_msg.id.clone() else { return };
            let params: CallParams = match in_msg
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
            tools::dispatch(shared, conn, id, params);
        }
        wire::METHOD_CALL_CLOSE => {
            let call_id = in_msg
                .params
                .as_ref()
                .and_then(|p| p.get("callId"))
                .cloned();
            if let Some(call_id) = call_id {
                if let Some(tx) = shared.lock().unwrap().calls.remove(&call_id.to_string()) {
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
    stream
        .write_all(head.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    stream
        .write_all(&body_bytes)
        .await
        .map_err(|e| e.to_string())?;

    let mut buf = Vec::new();
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
