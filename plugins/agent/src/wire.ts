// Core↔Plugin契約のwire型（docs/contracts/00001-00003）。
// 通信はtransport（WS + JSON-RPC 2.0）に統一。PluginはCoreのURLを知らない。

// ---- Link確立（transport上のJSON-RPC） ----

// link.hello（Core→Plugin request）のparams。
export interface HelloRequest {
  linkId: string;
  core: { id: string; version?: string };
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

// tools.catalog（Core→Plugin notification）の各要素。
// linkId がTool呼び出しの宛先になる。
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

export const METHOD_LINK_HELLO = "link.hello";
export const METHOD_LINK_PING = "link.ping";
export const METHOD_TOOLS_SET = "tools.set";
export const METHOD_TOOLS_CATALOG = "tools.catalog";
export const METHOD_PLUGINS_ADD = "plugins.add";
export const METHOD_PLUGINS_LIST = "plugins.list";
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
