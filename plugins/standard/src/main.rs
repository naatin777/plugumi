use plugumi_standard::link;

// ローカルPluginの既定ホストとポートは docs/contracts/00001 に従う。
const DEFAULT_HOSTNAME: &str = "127.0.0.1";
const USAGE: &str = "\
Usage: plugumi-standard [--port <port> | --listen <url> | <url>]

  --port <port>   Listen on 127.0.0.1 (default: 0 lets the OS choose)
  --listen <url>  Listen on http://<host>:<port>
  -h, --help      Show this help";

// httpsはTLS未実装のため受理しない。
fn parse_listen(endpoint: &str) -> Result<String, String> {
    let rest = endpoint
        .strip_prefix("http://")
        .ok_or_else(|| format!("endpoint must be an http:// URL (got {endpoint:?})"))?;
    let rest = rest.trim_end_matches('/');
    if rest.is_empty() || rest.contains('/') {
        return Err(format!(
            "endpoint must be http://<host>:<port> (got {endpoint:?})"
        ));
    }
    Ok(rest.to_string())
}

fn listen_on_port(value: &str) -> Result<String, String> {
    let port = value
        .parse::<u16>()
        .ok()
        .filter(|_| value.bytes().all(|byte| byte.is_ascii_digit()))
        .ok_or_else(|| format!("--port must be an integer from 0 to 65535 (got {value:?})"))?;
    Ok(format!("{DEFAULT_HOSTNAME}:{port}"))
}

fn parse_listen_argument(args: &[String]) -> Result<String, String> {
    match args {
        [] => listen_on_port("0"),
        [flag, value] if flag == "--port" => listen_on_port(value),
        [flag, value] if flag == "--listen" || flag == "--" => parse_listen(value),
        [argument] => {
            if let Some(value) = argument.strip_prefix("--port=") {
                listen_on_port(value)
            } else if let Some(value) = argument.strip_prefix("--listen=") {
                parse_listen(value)
            } else if !argument.starts_with('-') {
                parse_listen(argument)
            } else {
                Err(format!("Unknown option or missing value: {argument}"))
            }
        }
        _ => Err("Specify only one of --port, --listen, or a positional URL.".into()),
    }
}

#[tokio::main]
async fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() == 1 && (args[0] == "--help" || args[0] == "-h") {
        println!("{USAGE}");
        return;
    }
    let listen = match parse_listen_argument(&args) {
        Ok(listen) => listen,
        Err(e) => {
            eprintln!("{e}\n{USAGE}");
            std::process::exit(2);
        }
    };
    if let Err(e) = link::serve(&listen).await {
        eprintln!("serve: {e}");
        std::process::exit(1);
    }
}
