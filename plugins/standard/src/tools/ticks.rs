//! ticks — 定期通知のasync tool。count指定がなければ終端を持たない
//! （購読の形: 呼出元がcloseするかSession失効で終わる）。

use super::{boxed, mkdef, Call, Handler, ToolDef};
use serde_json::json;
use std::time::Duration;

pub(super) fn def() -> ToolDef {
    mkdef("ticks", "async", Handler::Async(handle))
}

fn handle(call: Call) -> super::BoxFut<()> {
    boxed(async move {
        let mut call = call;
        let interval_ms = call.input["intervalMs"].as_u64().unwrap_or(1000);
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
    })
}
