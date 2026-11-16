// Core↔Plugin契約のwire型（docs/contracts/00001-00003）。

// ---- REST ----

export interface HelloRequest {
  linkId: string;
  core: { url: string; version?: string };
}

export interface PluginInfo {
  id: string;
  version?: string;
  name?: string;
}

export interface ToolDeclaration {
  toolPath: string;
  kind: "sync" | "async";
  description?: string;
  tags?: string[];
}

export interface ListedTool extends ToolDeclaration {
  linkId: string;
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

export const isRequest = (m: Incoming) => m.method !== undefined && m.id !== undefined;
export const isNotif = (m: Incoming) => m.method !== undefined && m.id === undefined;
export const isResponse = (m: Incoming) => m.method === undefined;

export const METHOD_CALL = "tools.call";
export const METHOD_CALL_OUTPUT = "tools.call.output";
export const METHOD_CALL_RESULT = "tools.call.result";
export const METHOD_CALL_CLOSE = "tools.call.close";

// target側へ届く呼び出しparams（docs/contracts/00003:
// 中継時はtargetへtoolPathのみ伝える）。
export interface CallParams {
  toolPath: string;
  input?: unknown;
}
