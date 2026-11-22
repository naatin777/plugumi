use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::Command;
use tokio::time::timeout;

async fn respond(socket: TcpStream, expected_request: &str, status: &str, body: &str) {
    let mut reader = BufReader::new(socket);
    let mut line = String::new();
    reader.read_line(&mut line).await.unwrap();
    assert!(line.starts_with(expected_request), "{line:?}");
    let mut body_length = 0;
    loop {
        line.clear();
        assert_ne!(reader.read_line(&mut line).await.unwrap(), 0);
        if line == "\r\n" {
            break;
        }
        if let Some(length) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            body_length = length.trim().parse().unwrap();
        }
    }
    reader.read_exact(&mut vec![0; body_length]).await.unwrap();
    reader
        .get_mut()
        .write_all(
            format!(
                "HTTP/1.1 {status}\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            )
            .as_bytes(),
        )
        .await
        .unwrap();
}

async fn assert_rejected(upgrade: bool) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let child = Command::new(env!("CARGO_BIN_EXE_plugumi-standard"))
        .args(["--core", &format!("http://{address}")])
        .env_remove("HOME")
        .env_remove("XDG_CACHE_HOME")
        .env_remove("LOCALAPPDATA")
        .env_remove("PLUGUMI_TOKEN")
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();

    let output = timeout(Duration::from_secs(5), async {
        let (socket, _) = listener.accept().await.unwrap();
        if upgrade {
            respond(
                socket,
                "POST /v1/registrations ",
                "201 Created",
                r#"{"registrationId":"test-registration","leaseSeconds":60}"#,
            )
            .await;
            // tools宣言と（UIがビルドされていれば）asset push・UI登録の後にupgradeする。
            loop {
                let (socket, _) = listener.accept().await.unwrap();
                let mut reader = BufReader::new(socket);
                let mut request_line = String::new();
                reader.read_line(&mut request_line).await.unwrap();
                let mut body_length = 0;
                let mut header_line = String::new();
                loop {
                    header_line.clear();
                    assert_ne!(reader.read_line(&mut header_line).await.unwrap(), 0);
                    if header_line == "\r\n" {
                        break;
                    }
                    if let Some(length) = header_line.to_ascii_lowercase().strip_prefix("content-length:") {
                        body_length = length.trim().parse().unwrap();
                    }
                }
                reader.read_exact(&mut vec![0; body_length]).await.unwrap();
                let (status, body) = if request_line.starts_with("PUT /v1/registrations/test-registration/tools ") {
                    ("204 No Content", "")
                } else if request_line.starts_with("POST /v1/assets/missing ") {
                    ("200 OK", r#"{"missing":[]}"#)
                } else if request_line.starts_with("PUT /v1/registrations/test-registration/ui ") {
                    ("204 No Content", "")
                } else if request_line.starts_with("GET /v1/rpc?") {
                    ("403 Forbidden", "")
                } else {
                    panic!("unexpected request {request_line}");
                };
                reader
                    .get_mut()
                    .write_all(
                        format!(
                            "HTTP/1.1 {status}\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
                            body.len()
                        )
                        .as_bytes(),
                    )
                    .await
                    .unwrap();
                if request_line.starts_with("GET /v1/rpc?") {
                    break;
                }
            }
        } else {
            respond(socket, "POST /v1/registrations ", "401 Unauthorized", "").await;
        }

        tokio::select! {
            output = child.wait_with_output() => output.unwrap(),
            _ = listener.accept() => panic!("Standard retried a rejected Core"),
        }
    })
    .await
    .expect("Standard did not exit after Core rejected it");
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    let diagnostic = if upgrade {
        "/v1/rpc: HTTP 403"
    } else {
        "/v1/registrations: HTTP 401"
    };
    assert!(stderr.contains(diagnostic), "{stderr}");
}

#[tokio::test]
async fn rejected_registration_exits_unsuccessfully() {
    assert_rejected(false).await;
}

#[tokio::test]
async fn rejected_websocket_upgrade_does_not_retry() {
    assert_rejected(true).await;
}
