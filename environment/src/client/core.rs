//! Environment ProviderからCoreへ登録・宣言・WS接続する（contracts/00004）。
//! operation / Execution model: 登録 → operations宣言 → ready → WS接続。

use http_body_util::{BodyExt, Full, Limited};
use hyper::body::Bytes;
use hyper::client::conn::http1;
use hyper::{header, Method, Request, StatusCode, Uri};
use hyper_util::rt::TokioIo;
use serde::Deserialize;
use serde_json::{json, Value};
use std::net::IpAddr;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::watch;
use tokio::time::{sleep, timeout};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Error as WebSocketError;

use super::execution::ActiveExecutions;
use super::rpc::Connection;
use super::wire::{self, ForwardInvokeParams, Incoming};
use crate::operations;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Lease {
    registration_id: String,
    lease_seconds: u64,
}

#[derive(Debug)]
struct Failure {
    message: String,
    permanent: bool,
}

impl Failure {
    fn retry(message: impl ToString) -> Self {
        Self {
            message: message.to_string(),
            permanent: false,
        }
    }

    fn http(path: &str, status: StatusCode) -> Self {
        Self {
            message: format!("{path}: HTTP {status}"),
            permanent: matches!(
                status,
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::UPGRADE_REQUIRED
            ),
        }
    }
}

pub struct CoreClient {
    authority: String,
    host: String,
    port: u16,
    bearer: Option<hyper::header::HeaderValue>,
}

impl CoreClient {
    pub fn new(core_url: &str, token: Option<&str>) -> Result<Self, String> {
        let uri = core_url.parse::<Uri>().map_err(|e| e.to_string())?;
        let invalid = "Core URL must be a loopback HTTP origin";
        let authority = uri.authority().ok_or(invalid)?;
        let host = authority.host().trim_matches(['[', ']']);
        if uri.scheme_str() != Some("http")
            || uri.path() != "/"
            || uri.query().is_some()
            || authority.as_str().contains('@')
            || core_url.contains('#')
            || !(host.eq_ignore_ascii_case("localhost")
                || host
                    .parse::<IpAddr>()
                    .is_ok_and(|address| address.is_loopback()))
        {
            return Err(invalid.into());
        }
        let bearer = token
            .map(|token| format!("Bearer {token}").parse::<hyper::header::HeaderValue>())
            .transpose()
            .map_err(|_| "invalid PLUGUMI_TOKEN".to_string())?;
        Ok(Self {
            authority: authority.to_string(),
            host: host.to_string(),
            port: authority.port_u16().unwrap_or(80),
            bearer,
        })
    }

    pub fn authority(&self) -> &str {
        &self.authority
    }

    pub async fn run(self, instance_id: String, mut stop: watch::Receiver<bool>) {
        let mut registration_id = None;
        let mut backoff = 250;
        loop {
            let attempt = tokio::select! {
                _ = stop.wait_for(|stopped| *stopped) => break,
                result = self.prepare(&instance_id, &mut registration_id) => result,
            };
            let result = match attempt {
                Ok(lease) => self.run_session(lease, &mut stop).await,
                Err(error) => Err(error),
            };
            if *stop.borrow() {
                break;
            }
            if let Err(error) = result {
                crate::log::logln!("[environment] http://{}: {}", self.authority, error.message);
                if error.permanent {
                    return;
                }
            } else {
                backoff = 250;
            }
            // 複数Pluginが同じタイミングで切れたとき再接続が重ならないよう、
            // 契約どおりバックオフにジッターを足す（contracts/00004）。
            let jitter = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.subsec_millis() as u64 % (backoff / 4 + 1))
                .unwrap_or(0);
            tokio::select! {
                _ = stop.wait_for(|stopped| *stopped) => break,
                _ = sleep(Duration::from_millis(backoff + jitter)) => {}
            }
            backoff = (backoff * 2).min(5000);
        }
        if let Some(id) = registration_id {
            let _ = self
                .request(Method::DELETE, &format!("/v1/registrations/{id}"), None)
                .await;
        }
    }

    /// 登録 → operations宣言 → ready。いずれもlease内なら冪等なので、
    /// 再接続のたびに同じ手順を踏む。
    async fn prepare(
        &self,
        instance_id: &str,
        registration_id: &mut Option<String>,
    ) -> Result<Lease, Failure> {
        let response = self
            .request(
                Method::POST,
                "/v1/registrations",
                Some(json!({
                    "providerId": "environment",
                    "instanceId": instance_id,
                    "environment": "env/local",
                })),
            )
            .await?;
        let lease = serde_json::from_slice::<Lease>(&response).map_err(Failure::retry)?;
        if lease.lease_seconds == 0
            || lease.registration_id.is_empty()
            || !lease
                .registration_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err(Failure::retry("invalid lease returned by Core"));
        }
        *registration_id = Some(lease.registration_id.clone());
        let path = format!("/v1/registrations/{}", lease.registration_id);
        self.request(
            Method::PUT,
            &format!("{path}/operations"),
            Some(json!({ "operations": operations::declarations() })),
        )
        .await?;
        self.request(Method::POST, &format!("{path}/ready"), None)
            .await?;
        Ok(lease)
    }

    async fn run_session(
        &self,
        lease: Lease,
        stop: &mut watch::Receiver<bool>,
    ) -> Result<(), Failure> {
        let ws_url = format!(
            "ws://{}/v1/rpc?registrationId={}",
            self.authority, lease.registration_id
        );
        let mut request = ws_url.into_client_request().map_err(Failure::retry)?;
        if let Some(bearer) = &self.bearer {
            request
                .headers_mut()
                .insert(header::AUTHORIZATION, bearer.clone());
        }
        let connected = tokio::select! {
            _ = stop.wait_for(|stopped| *stopped) => return Ok(()),
            result = timeout(REQUEST_TIMEOUT, tokio_tungstenite::connect_async(request)) => result,
        };
        let (socket, _) = connected
            .map_err(Failure::retry)?
            .map_err(|error| match error {
                WebSocketError::Http(response) => Failure::http("/v1/rpc", response.status()),
                other => Failure::retry(other),
            })?;
        let active = ActiveExecutions::default();
        let handler_active = active.clone();
        let (connection, pump) = Connection::attach(socket, move |message, connection| {
            on_message(handler_active.clone(), message, connection);
        });
        crate::log::logln!(
            "[environment] connected to http://{} ({})",
            self.authority,
            lease.registration_id
        );
        let renew = async {
            let path = format!("/v1/registrations/{}/renew", lease.registration_id);
            loop {
                sleep(Duration::from_secs(lease.lease_seconds).div_f64(2.0)).await;
                self.request(Method::POST, &path, None).await?;
            }
        };
        let mut pump = pump;
        let result = tokio::select! {
            _ = &mut pump => None,
            _ = stop.wait_for(|stopped| *stopped) => Some(Ok(())),
            result = renew => Some(result),
        };
        if result.is_some() {
            connection.close();
            let _ = pump.await;
        }
        result.unwrap_or(Ok(()))
    }

    async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Bytes, Failure> {
        let (content_type, bytes) = match body {
            Some(value) => (Some("application/json"), Bytes::from(value.to_string())),
            None => (None, Bytes::new()),
        };
        self.send(method, path, content_type, bytes).await
    }

    async fn send(
        &self,
        method: Method,
        path: &str,
        content_type: Option<&str>,
        bytes: Bytes,
    ) -> Result<Bytes, Failure> {
        timeout(REQUEST_TIMEOUT, async {
            let socket = TcpStream::connect((self.host.as_str(), self.port))
                .await
                .map_err(Failure::retry)?;
            let (mut sender, driver) = http1::handshake(TokioIo::new(socket))
                .await
                .map_err(Failure::retry)?;
            tokio::spawn(async move {
                let _ = driver.await;
            });
            let mut request = Request::builder()
                .method(method)
                .uri(path)
                .header(header::HOST, &self.authority);
            if let Some(bearer) = &self.bearer {
                request = request.header(header::AUTHORIZATION, bearer);
            }
            if let Some(content_type) = content_type {
                request = request.header(header::CONTENT_TYPE, content_type);
            }
            let body = Full::new(bytes);
            let response = sender
                .send_request(request.body(body).map_err(Failure::retry)?)
                .await
                .map_err(Failure::retry)?;
            let status = response.status();
            if !status.is_success() {
                return Err(Failure::http(path, status));
            }
            Ok(Limited::new(response.into_body(), 1 << 20)
                .collect()
                .await
                .map_err(Failure::retry)?
                .to_bytes())
        })
        .await
        .map_err(Failure::retry)?
    }
}

fn on_message(active: ActiveExecutions, message: Incoming, connection: Connection) {
    match message.method.as_deref() {
        Some(wire::METHOD_OPERATIONS_INVOKE) => {
            let Some(id) = message.id else { return };
            let params: Option<ForwardInvokeParams> = message
                .params
                .and_then(|params| serde_json::from_value(params).ok());
            match params {
                Some(params) => operations::dispatch(active, connection, id, params),
                None => connection.respond(
                    id,
                    Err(wire::RpcError {
                        code: -32602,
                        message: "invalid params".into(),
                        data: None,
                    }),
                ),
            }
        }
        // cancelはnotification。executionIdを照合してrunning実行へ配送する。
        Some(wire::METHOD_EXECUTIONS_CANCEL) => {
            if let Some(id) = message
                .params
                .as_ref()
                .and_then(|params| params.get("executionId"))
                .and_then(|id| id.as_str())
            {
                active.cancel(id);
            }
        }
        _ => {
            if let Some(id) = message.id {
                connection.respond(
                    id,
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

#[cfg(test)]
mod tests {
    use super::CoreClient;

    #[test]
    fn accepts_loopback_origins_without_rewriting_the_ipv6_authority() {
        let ipv6 = CoreClient::new("http://[::1]:7700/", None).unwrap();
        assert_eq!(ipv6.authority(), "[::1]:7700");
        assert_eq!(ipv6.host, "::1");
        assert_eq!(ipv6.port, 7700);
        assert!(CoreClient::new("http://localhost:7700", Some("test-token")).is_ok());
    }

    #[test]
    fn rejects_non_loopback_or_non_origin_core_urls() {
        for invalid in [
            "http://192.0.2.1:7700",
            "https://localhost:7700",
            "http://user@localhost:7700",
            "http://localhost:7700/control",
            "http://localhost:7700/?query=value",
        ] {
            assert!(CoreClient::new(invalid, None).is_err(), "{invalid}");
        }
    }
}
