//! exec: コマンドを実行し、stdout/stderrを途中出力として流すasync tool。
//! closeされたら子プロセスをkillする。

use super::ToolCall;
use serde_json::json;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

pub async fn handle(mut call: ToolCall) {
    let Some(command) = call.input["command"].as_str() else {
        call.result_error("input.command is required");
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
            call.result_error(&e.to_string());
            return;
        }
    };

    // stdout/stderr の行を途中出力として流す。
    let mut out_lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let mut err_lines = BufReader::new(child.stderr.take().unwrap()).lines();
    let mut out_open = true;
    let mut err_open = true;
    let mut status = None;
    // シェルが終了しても、両方の出力を読み切るまでは取消を受け付ける。
    while status.is_none() || out_open || err_open {
        tokio::select! {
            line = out_lines.next_line(), if out_open => match line {
                Ok(Some(line)) => call.chunk(json!({"stream": "stdout", "line": line})),
                _ => out_open = false,
            },
            line = err_lines.next_line(), if err_open => match line {
                Ok(Some(line)) => call.chunk(json!({"stream": "stderr", "line": line})),
                _ => err_open = false,
            },
            _ = call.closed() => {
                if status.is_none() {
                    let _ = child.kill().await;
                }
                call.result_error("closed by caller");
                return;
            },
            result = child.wait(), if status.is_none() => status = Some(result),
        }
    }
    match status.unwrap() {
        Ok(s) => call.result(json!({"exitCode": s.code()})),
        Err(e) => call.result_error(&e.to_string()),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::rpc::Connection;
    use futures_util::StreamExt;
    use serde_json::Value;
    use std::time::Duration;
    use tokio::io::duplex;
    use tokio::sync::watch;
    use tokio::time::timeout;
    use tokio_tungstenite::{tungstenite::protocol::Role, WebSocketStream};

    #[tokio::test]
    async fn close_interrupts_output_drain_after_the_shell_exits() {
        let (plugin, core) = duplex(4096);
        let mut core = WebSocketStream::from_raw_socket(core, Role::Server, None).await;
        let plugin = WebSocketStream::from_raw_socket(plugin, Role::Client, None).await;
        let (connection, _) = Connection::attach(plugin, |_, _| {});
        let (close, close_rx) = watch::channel(false);
        // 親シェルが回収された後も出力パイプを開いたままにする。
        let command = r#"parent=$$; (while kill -0 "$parent" 2>/dev/null; do sleep 0.02; done; printf 'shell exited\n'; sleep 3) &"#;
        let task = tokio::spawn(handle(ToolCall {
            connection,
            id: json!("exec-test"),
            tool_path: "exec".into(),
            input: json!({"command": command}),
            close_rx,
        }));
        let chunk = timeout(Duration::from_secs(2), core.next())
            .await
            .expect("no output after the shell exited")
            .unwrap()
            .unwrap();
        let chunk: Value = serde_json::from_str(chunk.to_text().unwrap()).unwrap();
        assert_eq!(chunk["params"]["payload"]["line"], "shell exited");

        close.send(true).unwrap();
        let result = timeout(Duration::from_secs(1), core.next())
            .await
            .expect("close waited for output pipes to reach EOF")
            .unwrap()
            .unwrap();
        let result: Value = serde_json::from_str(result.to_text().unwrap()).unwrap();
        assert_eq!(result["method"], crate::wire::METHOD_CALL_RESULT);
        assert_eq!(result["params"]["error"]["message"], "closed by caller");
        task.await.unwrap();
    }
}
