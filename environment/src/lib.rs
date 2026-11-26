//! plugumi environment provider: Plugin起点の接続（docs/contracts/00004）の
//! Rust実装。基本Tool群（echo/fs/exec/ticks）を提供する検証用Plugin。

pub mod core_client;
pub mod log;
pub mod registration;
pub mod rpc;
pub mod tools;
pub mod wire;
