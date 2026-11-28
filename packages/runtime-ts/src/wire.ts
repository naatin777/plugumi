// Plugin起点のRESTとWS RPCのwire型（docs/contracts/00004）。
// operation / Execution model。旧tool model（tools.call / kind）は廃止。

export interface RegistrationLease {
  coreId: string;
  registrationId: string;
  leaseSeconds: number;
  expiresAt: string;
}

export interface OperationDeclaration {
  path: string;
  description?: string;
  inputSchema?: unknown;
  streamSchema?: unknown;
  resultSchema?: unknown;
}

// ---- JSON-RPC 2.0 ----

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

// 受信メッセージの判別用の生構造。
export interface Incoming {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: RpcError;
}

export function isRequest(message: Incoming): boolean {
  return message.method !== undefined && message.id !== undefined;
}
export function isNotification(message: Incoming): boolean {
  return message.method !== undefined && message.id === undefined;
}
export function isResponse(message: Incoming): boolean {
  return message.method === undefined;
}

// WS接続上のmethod（contracts/00004）。
export const METHOD_OPERATIONS_INVOKE = "operations.invoke";
export const METHOD_OPERATIONS_EVENT = "operations.event";
export const METHOD_EXECUTIONS_CANCEL = "executions.cancel";
export const METHOD_ASSETS_GET = "assets.get";

// PluginがWS接続上で受け取るoperations.invokeのparams。
export interface ForwardInvokeParams {
  operation: string;
  executionId: string;
  input?: unknown;
}
