use plugumi_standard::link;

// 起動引数はPlugin Endpoint（`http://<host>:<port>`）。
// Coreが接続するendpointと同じ文字列に揃える（docs/contracts/00001）。
// httpsはTLS未実装のため受理しない。
fn parse_listen(endpoint: &str) -> Result<String, String> {
    let rest = endpoint
        .strip_prefix("http://")
        .ok_or_else(|| format!("endpoint must be an http:// URL (got {endpoint:?})"))?;
    let rest = rest.trim_end_matches('/');
    if rest.is_empty() || rest.contains('/') {
        return Err(format!("endpoint must be http://<host>:<port> (got {endpoint:?})"));
    }
    Ok(rest.to_string())
}

#[tokio::main]
async fn main() {
    let endpoint = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "http://127.0.0.1:9001".to_string());
    let listen = match parse_listen(&endpoint) {
        Ok(listen) => listen,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    if let Err(e) = link::serve(&listen).await {
        eprintln!("serve: {e}");
        std::process::exit(1);
    }
}
