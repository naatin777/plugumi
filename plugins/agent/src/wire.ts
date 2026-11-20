// Plugin起点のRESTとWS RPCのwire型（docs/contracts/00004）。

import { z } from "zod";

export const registrationLeaseSchema = z.object({
  coreId: z.string().min(1),
  registrationId: z.string().min(1),
  leaseSeconds: z.number().int().positive(),
  expiresAt: z.string(),
});

const toolDeclarationSchema = z.object({
  toolPath: z.string().min(1),
  kind: z.enum(["sync", "async"]).default("sync"),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  inputSchema: z.unknown().optional(),
  outputSchema: z.unknown().optional(),
});
export type ToolDeclaration = z.infer<typeof toolDeclarationSchema>;

export type ListedTool = ToolDeclaration & { registrationId: string };
export const registrySnapshotSchema = z.object({
  coreId: z.string().min(1),
  revision: z.string().min(1),
  registrations: z.array(z.object({
    registrationId: z.string().min(1),
    rpcAvailable: z.boolean(),
    tools: z.array(toolDeclarationSchema),
  })),
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
export const METHOD_CALL_CHUNK = "tools.call.chunk";
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
