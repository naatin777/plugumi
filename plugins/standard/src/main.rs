use plugumi_standard::session;

#[tokio::main]
async fn main() {
    let listen = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "127.0.0.1:9001".to_string());
    if let Err(e) = session::serve(&listen).await {
        eprintln!("serve: {e}");
        std::process::exit(1);
    }
}
