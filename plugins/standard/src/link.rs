//! Plugin側のLink機構。hello応答・tools.set送信・ping・transport接続・
//! tools.callの配送までをまとめる。PluginはCoreを事前に知らず、
//! helloで受け取った core_url 宛てに以後の送信を行う。
//!
//! LinkはlinkIdごとに独立して管理する — 複数のCoreが
//! 同じPluginへhelloしてよい（docs/decisionsの複数Core方針）。

use axum::{
    extract::{Request, State},
    http::StatusCode,
    response::Json,
    routing::post,
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
use crate::wire::{self, CallParams, HelloRequest, HelloResponse, Incoming, PluginInfo};

/// 1つのLinkの状態。Coreが増えてもlinkIdごとに分かれる。
pub struct LinkInner {
    link_id: String,
    core_url: String,
    conn: Option<Conn>,
    /// 実行中callのcloseシグナル（callId → close_tx）。
    pub(crate) calls: HashMap<String, watch::Sender<bool>>,
}

pub type SharedLink = Arc<Mutex<LinkInner>>;

/// Plugin全体の状態。Core別のLinkを束ねる。
pub struct PluginState {
    links: HashMap<String, SharedLink>, // linkId →
}

pub type Shared = Arc<Mutex<PluginState>>;

/// Plugin HTTP serverを立てる（hello受付）。
pub async fn serve(listen: &str) -> Result<(), String> {
    let shared: Shared = Arc::new(Mutex::new(PluginState {
        links: HashMap::new(),
    }));
    let app = Router::new()
        .route("/v1/link/hello", post(handle_hello))
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

async fn handle_hello(
    State(shared): State<Shared>,
    Json(req): Json<HelloRequest>,
) -> Result<Json<HelloResponse>, (StatusCode, Json<Value>)> {
    // 同じCoreからの再helloは、そのCoreの旧Linkを畳んでから受け入れる。
    // （別CoreのLinkは生かす — 複数Core接続を許すため）
    let stale_ids: Vec<String> = {
        let state = shared.lock().unwrap();
        state
            .links
            .iter()
            .filter(|(_, l)| l.lock().unwrap().core_url == req.core.url)
            .map(|(id, _)| id.clone())
            .collect()
    };
    for id in stale_ids {
        if let Some(stale) = shared.lock().unwrap().links.remove(&id) {
            teardown_link(&stale);
        }
    }

    let link: SharedLink = Arc::new(Mutex::new(LinkInner {
        link_id: req.link_id.clone(),
        core_url: req.core.url.clone(),
        conn: None,
        calls: HashMap::new(),
    }));
    shared
        .lock()
        .unwrap()
        .links
        .insert(req.link_id.clone(), link.clone());

    eprintln!(
        "[standard] link established: {} (core {})",
        req.link_id, req.core.url
    );
    tokio::spawn(start_link(shared, link));
    Ok(Json(HelloResponse {
        plugin: PluginInfo {
            id: "standard".into(),
            version: Some("0.1.0".into()),
            name: Some("Plugumi Standard Plugin".into()),
        },
    }))
}

/// Linkを畳む: 実行中callにcloseを送り、transportを切る。
fn teardown_link(link: &SharedLink) {
    let mut inner = link.lock().unwrap();
    for (_, close_tx) in inner.calls.drain() {
        let _ = close_tx.send(true);
    }
    // connを捨てればwriter taskが終わり、transportも閉じる。
    inner.conn = None;
}

/// Link確立後のライフサイクル: tools.set → pingループ → transport。
/// 途中でLinkが畳まれても（Core側の失効・再起動hello）、
/// ping/接続loopはlinks mapを見て終わる。
async fn start_link(shared: Shared, link: SharedLink) {
    let (link_id, core_url) = {
        let inner = link.lock().unwrap();
        (inner.link_id.clone(), inner.core_url.clone())
    };

    // tools.setは短く再試行する — 直列失敗でもLinkを無toolにしない。
    let tools = tools::decls();
    for attempt in 1..=5 {
        if !link_alive(&shared, &link_id) {
            return;
        }
        match http_post_json(
            &format!("{core_url}/v1/tools/set"),
            &wire::ToolsSetRequest {
                link_id: link_id.clone(),
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

    tokio::spawn(ping_loop(shared.clone(), core_url.clone(), link_id.clone()));
    connect_transport_loop(shared, link, &link_id).await;
}

/// Linkがまだ生きているか（mapに残っているか）。
fn link_alive(shared: &Shared, link_id: &str) -> bool {
    shared.lock().unwrap().links.contains_key(link_id)
}

async fn ping_loop(shared: Shared, core_url: String, link_id: String) {
    let mut t = tokio::time::interval(Duration::from_secs(30));
    loop {
        t.tick().await;
        if !link_alive(&shared, &link_id) {
            return;
        }
        let _ = http_post_json(
            &format!("{core_url}/v1/link/ping"),
            &wire::PingRequest {
                link_id: link_id.clone(),
            },
        )
        .await;
    }
}

/// transportを張り続ける。切断されてもLinkが生きている限り再試行する
/// （transport切断とLink失効は別 — contracts/00002）。
async fn connect_transport_loop(shared: Shared, link: SharedLink, link_id: &str) {
    loop {
        if !link_alive(&shared, link_id) {
            return;
        }
        match connect_once(shared.clone(), link.clone(), link_id).await {
            Ok(pump) => {
                pump.await.ok();
                link.lock().unwrap().conn = None;
            }
            Err(e) => eprintln!("[standard] transport connect failed: {e}"),
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}

async fn connect_once(
    shared: Shared,
    link: SharedLink,
    link_id: &str,
) -> Result<tokio::task::JoinHandle<()>, String> {
    let core_url = link.lock().unwrap().core_url.clone();
    let url = core_url.replace("http://", "ws://") + "/v1/transport?linkId=" + link_id;
    let on_msg = {
        let link = link.clone();
        move |message: Incoming, conn: Conn| {
            on_transport_message(shared.clone(), link.clone(), message, conn)
        }
    };
    let (conn, pump) = Conn::connect(&url, on_msg).await?;
    link.lock().unwrap().conn = Some(conn);
    Ok(pump)
}

/// transport上のrequest/notification配送。
fn on_transport_message(_shared: Shared, link: SharedLink, message: Incoming, conn: Conn) {
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
