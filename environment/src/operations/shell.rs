//! shell/exec: コマンドを実行し、stdout/stderrを進行として流すoperation。
//! 接続が切れたら子プロセスをkillする。

use crate::client::execution::Execution;
use serde_json::json;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

pub async fn handle(mut execution: Execution) {
    let Some(command) = execution.input["command"].as_str() else {
        execution.error("input.command is required");
        return;
    };
    let mut child = match Command::new("sh")
        .arg("-c")
        .arg(command)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            execution.error(&e.to_string());
            return;
        }
    };

    // stdout/stderr の行を進行として流す。
    let mut out_lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let mut err_lines = BufReader::new(child.stderr.take().unwrap()).lines();
    let mut out_open = true;
    let mut err_open = true;
    let mut status = None;
    // シェルが終了しても、両方の出力を読み切るまでは切断を監視する。
    while status.is_none() || out_open || err_open {
        tokio::select! {
            line = out_lines.next_line(), if out_open => match line {
                Ok(Some(line)) => execution.progress(json!({"stream": "stdout", "line": line})),
                _ => out_open = false,
            },
            line = err_lines.next_line(), if err_open => match line {
                Ok(Some(line)) => execution.progress(json!({"stream": "stderr", "line": line})),
                _ => err_open = false,
            },
            _ = execution.disconnected() => {
                if status.is_none() {
                    let _ = child.kill().await;
                }
                // 接続切断時はCore側でproviderDisconnectedになるので終端eventは不要。
                return;
            },
            result = child.wait(), if status.is_none() => status = Some(result),
        }
    }
    match status.unwrap() {
        Ok(s) => execution.result(json!({"exitCode": s.code()})),
        Err(e) => execution.error(&e.to_string()),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::client::rpc::Connection;
    use futures_util::StreamExt;
    use serde_json::Value;
    use std::time::Duration;
    use tokio::io::duplex;
    use tokio::time::timeout;
    use tokio_tungstenite::{tungstenite::protocol::Role, WebSocketStream};

    #[tokio::test]
    async fn disconnect_interrupts_output_drain_after_the_shell_exits() {
        let (plugin, core) = duplex(4096);
        let mut core = WebSocketStream::from_raw_socket(core, Role::Server, None).await;
        let plugin = WebSocketStream::from_raw_socket(plugin, Role::Client, None).await;
        let (connection, _) = Connection::attach(plugin, |_, _| {});
        // 親シェルが回収された後も出力パイプを開いたままにする。
        let command = r#"parent=$$; (while kill -0 "$parent" 2>/dev/null; do sleep 0.02; done; printf 'shell exited\n'; sleep 3) &"#;
        let execution = Execution::new(
            connection.clone(),
            "exec-test".into(),
            "shell/exec".into(),
            json!({"command": command}),
        );
        let task = tokio::spawn(handle(execution));
        let progress = timeout(Duration::from_secs(2), core.next())
            .await
            .expect("no output after the shell exited")
            .unwrap()
            .unwrap();
        let progress: Value = serde_json::from_str(progress.to_text().unwrap()).unwrap();
        assert_eq!(
            progress["method"],
            crate::client::wire::METHOD_OPERATIONS_EVENT
        );
        assert_eq!(progress["params"]["type"], "progress");
        assert_eq!(progress["params"]["payload"]["line"], "shell exited");

        // 接続を切ると、出力パイプのEOFを待たずにhandlerが終わる。
        connection.close();
        timeout(Duration::from_secs(1), task)
            .await
            .expect("handler did not stop after the connection closed")
            .unwrap();
    }
}
