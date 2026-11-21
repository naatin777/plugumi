use plugumi_standard::{core_client::CoreClient, registration};
use std::collections::HashSet;
use std::process::ExitCode;
use std::time::Duration;
use tokio::sync::watch;

const USAGE: &str = "Usage: plugumi-standard [--core <url>]... [<url>...]";

fn clients() -> Result<Vec<CoreClient>, String> {
    let mut arguments = std::env::args().skip(1);
    let mut addresses = Vec::new();
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "-h" | "--help" => {
                println!("{USAGE}");
                return Ok(Vec::new());
            }
            "--core" => addresses.push(arguments.next().ok_or("missing --core URL")?),
            _ if argument.starts_with("--core=") => addresses.push(argument[7..].to_string()),
            _ if argument.starts_with('-') => return Err(format!("unknown option: {argument}")),
            _ => addresses.push(argument),
        }
    }
    if addresses.is_empty() {
        addresses
            .push(std::env::var("PLUGUMI_CORE_URL").map_err(|_| "Specify at least one Core URL")?);
    }
    let token = std::env::var("PLUGUMI_TOKEN").ok();
    let mut seen = HashSet::new();
    let mut clients = Vec::new();
    for address in addresses {
        let client = CoreClient::new(&address, token.as_deref().filter(|token| !token.is_empty()))?;
        if seen.insert(client.authority().to_string()) {
            clients.push(client);
        }
    }
    Ok(clients)
}

#[tokio::main]
async fn main() -> ExitCode {
    let clients = match clients() {
        Ok(clients) if !clients.is_empty() => clients,
        Ok(_) => return ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let id = registration::new_instance_id();
    let local = registration::register("standard", &id, env!("CARGO_PKG_VERSION"));
    let (stop, receiver) = watch::channel(false);
    let mut tasks = tokio::task::JoinSet::new();
    for client in clients {
        tasks.spawn(client.run(id.clone(), receiver.clone()));
    }
    let shutdown = shutdown_signal();
    tokio::pin!(shutdown);
    let mut heartbeat = tokio::time::interval(Duration::from_secs(5));
    while !tasks.is_empty() {
        tokio::select! {
            _ = &mut shutdown => {
                let _ = stop.send(true);
                while tasks.join_next().await.is_some() {}
                return ExitCode::SUCCESS;
            }
            finished = tasks.join_next() => {
                if let Some(Err(error)) = finished {
                    eprintln!("[standard] Core client task failed: {error}");
                }
            }
            _ = heartbeat.tick() => {
                if let Some(local) = &local {
                    local.refresh();
                }
            }
        }
    }
    // 停止シグナルなしに全タスクが終了したなら、接続を維持できるCoreがない。
    ExitCode::FAILURE
}

async fn shutdown_signal() {
    #[cfg(unix)]
    if let Ok(mut terminate) =
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
    {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = terminate.recv() => {}
        }
        return;
    }
    let _ = tokio::signal::ctrl_c().await;
}
