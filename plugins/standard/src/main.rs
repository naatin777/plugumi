use plugumi_standard::link;

// 起動引数はPlugin Endpoint（`ws://<host>:<port>`）。
// Coreがdialするendpointと同じ文字列に揃える（docs/contracts/00001）。
// wssはTLS未実装のため受理しない。
fn parse_listen(endpoint: &str) -> Result<String, String> {
    let rest = endpoint
        .strip_prefix("ws://")
        .ok_or_else(|| format!("endpoint must be a ws:// URL (got {endpoint:?})"))?;
    let rest = rest.trim_end_matches('/');
    if rest.is_empty() || rest.contains('/') {
        return Err(format!("endpoint must be ws://<host>:<port> (got {endpoint:?})"));
    }
    Ok(rest.to_string())
}

#[tokio::main]
async fn main() {
    let endpoint = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "ws://127.0.0.1:9001".to_string());
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
