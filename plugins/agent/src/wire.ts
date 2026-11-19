// Core↔Plugin契約のwire型（docs/contracts/00001-00003）。
// 共通規格はCore→Plugin REST、tools.call系のみtransport（WS + JSON-RPC 2.0）。
// PluginはCoreのURLを知らない。

import { z } from "zod";

// ---- Link確立（Core→Plugin REST。contracts/00001） ----

// POST /v1/link/hello のbody。
export const helloRequestSchema = z.object({
  linkId: z.string().min(1),
  core: z.object({ id: z.string().min(1), version: z.string().optional() }),
});

// POST /v1/link/ping のbody（Core→Pluginの生存確認probe）。
export const pingRequestSchema = z.object({ linkId: z.string().min(1) });

export interface PluginInfo {
  id: string;
  version?: string;
  name?: string;
}

const toolDeclarationSchema = z.object({
  toolPath: z.string().min(1),
  kind: z.enum(["sync", "async"]).default("sync"),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  inputSchema: z.unknown().optional(),
  outputSchema: z.unknown().optional(),
});
export type ToolDeclaration = z.infer<typeof toolDeclarationSchema>;

// catalogの各ToolのlinkIdは呼び出し先を示す。
const listedToolSchema = toolDeclarationSchema.extend({ linkId: z.string().min(1) });
export type ListedTool = z.infer<typeof listedToolSchema>;

// POST /v1/tools/catalog のbody。linkIdは宛先Linkの識別
// （複数CoreからのLinkを区別するため）。
export const toolsCatalogRequestSchema = pingRequestSchema.extend({
  tools: z.array(listedToolSchema),
});

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
export const isNotification = (m: Incoming) => m.method !== undefined && m.id === undefined;
export const isResponse = (m: Incoming) => m.method === undefined;

// transport（WS）上のmethodはtools.call系のみ。
// 登録・検査系はRESTで流れ、ここには現れない。
export const METHOD_CALL = "tools.call";
export const METHOD_CALL_OUTPUT = "tools.call.output";
export const METHOD_CALL_RESULT = "tools.call.result";
export const METHOD_CALL_CLOSE = "tools.call.close";

// Pluginがtransport上で受け取るtools.callのparams。
// caller→Core間では {target, input} 形だが、Coreが中継する際に
// toolPathへ正規化される（docs/contracts/00003）。
// Go側の wire.ForwardCallParams と同じ形。
export interface ForwardCallParams {
  toolPath: string;
  input?: unknown;
}
