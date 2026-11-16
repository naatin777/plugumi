//! ticks: 定期通知のasync tool。count指定がなければ終端を持たない
//! （購読の形: 呼び出し元がcloseするかSession失効で終わる）。

use super::Call;
use serde_json::json;
use std::time::Duration;

pub async fn handle(mut call: Call) {
    // 0はtokio::time::intervalがpanicするため明示エラーにする。
    let interval_ms = call.input["intervalMs"].as_u64().unwrap_or(1000);
    if interval_ms == 0 {
        call.result_error("intervalMs must be >= 1");
        return;
    }
    let count = call.input["count"].as_u64();
    let mut t = tokio::time::interval(Duration::from_millis(interval_ms));
    let mut seq = 0u64;
    loop {
        tokio::select! {
            _ = t.tick() => {
                seq += 1;
                call.output(json!({"seq": seq}));
                if let Some(c) = count {
                    if seq >= c {
                        call.result(json!({"ticks": seq}));
                        return;
                    }
                }
            }
            _ = call.closed() => return, // 購読終了
        }
    }
}
