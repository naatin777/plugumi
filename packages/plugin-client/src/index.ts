// Coreへ接続するTool側PluginのSDK（contracts/00004）。
// Panel側のSDKはpackages/plugin-view。
export { PluginClient, coreURL } from "./client.js";
export type { PluginClientOptions } from "./client.js";
export { Connection } from "./rpc.js";
export type { Socket } from "./rpc.js";
export { dispatchToolCall, toolDeclarations } from "./tools.js";
export type { Tool, ToolHandler } from "./tools.js";
export {
  cacheDirectory,
  newInstanceId,
  recordsDirectory,
  registerPlugin,
} from "./record.js";
export type { PluginRegistration } from "./record.js";
export {
  METHOD_CALL,
  METHOD_CALL_CHUNK,
  METHOD_CALL_CLOSE,
  METHOD_CALL_RESULT,
} from "./wire.js";
export type {
  ForwardCallParams,
  Incoming,
  ListedTool,
  RpcError,
  ToolDeclaration,
} from "./wire.js";
