// Core↔Plugin契約のwire型（docs/contracts/00001-00003）。
// 共通規格はCore→Plugin REST、tools.call系のみtransport（WS + JSON-RPC 2.0）。
// PluginはCoreのURLを知らない。

// ---- Link確立（Core→Plugin REST。contracts/00001） ----

// POST /v1/link/hello のbody。
export interface HelloRequest {
  linkId: string;
  core: { id: string; version?: string };
}

// POST /v1/link/ping のbody（Core→Pluginの生存確認probe）。
export interface PingRequest {
  linkId: string;
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

// POST /v1/tools/catalog のbody。linkIdは宛先Linkの識別
// （複数CoreからのLinkを区別するため）。
export interface CatalogRequest {
  linkId: string;
  tools: ListedTool[];
}

// tools.catalog・GET /v1/tools の各要素。
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

// transport（WS）上のmethodはtools.call系のみ。
// 登録・検査系はRESTで流れ、ここには現れない。
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
