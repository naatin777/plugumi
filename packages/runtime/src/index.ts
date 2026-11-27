// @plugumi/runtime: plugin runtime作者向けSDK（contracts/00004）。
// Core接続・operation宣言とdispatch・UI asset応答を担う。
// view側（panel内JS）のSDKは @plugumi/view で、Coreを知らない別物。

export { PluginRuntime, coreURL } from "./client.js";
export type { PluginRuntimeOptions } from "./client.js";
export { Execution, ActiveExecutions } from "./execution.js";
export { Connection } from "./rpc.js";
export type { Socket } from "./rpc.js";
export { declarations } from "./operations.js";
export type { Operation, StreamOperation, TerminalOperation } from "./operations.js";
export type { UI, PanelDeclaration, UIManifest } from "./assets.js";
export { Catalog } from "./catalog.js";
export type { CatalogOperation } from "./catalog.js";
export type { ExecutionRecord, ExecutionsEventParams } from "./caller.js";
export { cacheDirectory, newInstanceId, recordsDirectory, registerPlugin } from "./record.js";
export type { PluginRegistration } from "./record.js";
export type { ForwardInvokeParams, Incoming, OperationDeclaration, RpcError } from "./wire.js";
