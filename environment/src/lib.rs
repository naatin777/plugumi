//! plugumi environment provider: Plugin起点の接続（docs/contracts/00004）の
//! Rust実装。env/localのoperation群（echo/filesystem/shell/dev）を提供する
//! 検証用Plugin。
//!
//! client/ はCore protocol話者としてのlibrary的な層、
//! operations/ はこのprovider固有のoperation実装。

pub mod client;
pub mod log;
pub mod operations;
pub mod registration;
