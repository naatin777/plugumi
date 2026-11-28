//! Core protocol話者としてのclient library的な部分。
//! provider実装（crate::operations）から独立しており、
//! 将来のRust plugin向けclient libraryの種になる層。

pub mod core;
pub mod execution;
pub mod rpc;
pub mod wire;
