//! dev/ticks: 定期tickの検証用operation。count指定がなければ
//! RPC接続の切断まで終端を持たない（stream動作の確認用）。

use crate::client::execution::Execution;
use serde_json::json;
use std::time::Duration;

pub async fn ticks(mut execution: Execution) {
    // 0はtokio::time::intervalがpanicするため明示エラーにする。
    let interval_ms = execution.input["intervalMs"].as_u64().unwrap_or(1000);
    if interval_ms == 0 {
        execution.error("intervalMs must be >= 1");
        return;
    }
    let count = execution.input["count"].as_u64();
    let mut cancel = execution.cancel_watch();
    let mut closed = execution.close_watch();
    let mut ticker = tokio::time::interval(Duration::from_millis(interval_ms));
    let mut seq = 0u64;
    loop {
        tokio::select! {
            _ = ticker.tick() => {
                seq += 1;
                execution.progress(json!({"seq": seq}));
                if let Some(c) = count {
                    if seq >= c {
                        execution.result(json!({"ticks": seq}));
                        return;
                    }
                }
            }
            _ = cancel.changed() => {
                execution.cancel();
                return;
            }
            _ = closed.changed() => {
                // 接続が切れたらCore側でproviderDisconnectedとしてfailedになる。
                // 送っても届かないので終端eventは送らず終える。
                return;
            }
        }
    }
}
