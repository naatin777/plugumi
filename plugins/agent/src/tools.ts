// agent pluginが提供するTool群。
// MVPは agent/echo のみ（自己呼出の疎通確認用）。

import type { Conn } from "./rpc.js";
import type { CallParams, RpcError, ToolDecl } from "./wire.js";

type SyncHandler = (input: unknown) => unknown | Promise<unknown>;

const tools = new Map<string, { decl: ToolDecl; handler: SyncHandler }>([
  [
    "agent/echo",
    {
      decl: { toolPath: "agent/echo", kind: "sync" },
      handler: (input) => ({ echo: input, from: "agent" }),
    },
  ],
]);

export function toolDecls(): ToolDecl[] {
  return [...tools.values()].map((t) => t.decl);
}

// 着信 tools.call を捌く（同期返却のみ。async toolを足すときはCall機構を作る）。
export async function dispatchCall(
  _conn: Conn,
  reqId: unknown,
  params: CallParams,
): Promise<{ result?: unknown; error?: RpcError }> {
  const tool = tools.get(params.toolPath);
  if (!tool) {
    return {
      error: { code: -32601, message: `unknown toolPath: ${params.toolPath}` },
    };
  }
  try {
    return { result: await tool.handler(params.input) };
  } catch (e) {
    return { error: { code: -32000, message: String(e) } };
  }
}
