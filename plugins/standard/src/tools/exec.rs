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
    let status = loop {
        tokio::select! {
            line = out_lines.next_line(), if out_open => match line {
                Ok(Some(line)) => call.output(json!({"stream": "stdout", "line": line})),
                _ => out_open = false,
            },
            line = err_lines.next_line(), if err_open => match line {
                Ok(Some(line)) => call.output(json!({"stream": "stderr", "line": line})),
                _ => err_open = false,
            },
            _ = call.closed() => {
                let _ = child.kill().await;
                call.result_error("closed by caller");
                return;
            },
            status = child.wait() => break status,
        }
    };
    // wait()が先に返っても、パイプに残った出力をEOFまで読み切ってから
    // resultを送る。読み切らずに抜けると最後のoutputが欠落する。
    while let Ok(Some(line)) = out_lines.next_line().await {
        call.output(json!({"stream": "stdout", "line": line}));
    }
    while let Ok(Some(line)) = err_lines.next_line().await {
        call.output(json!({"stream": "stderr", "line": line}));
    }
    match status {
        Ok(s) => call.result(json!({"exitCode": s.code()})),
        Err(e) => call.result_error(&e.to_string()),
    }
}
