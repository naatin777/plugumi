// Pluginが提供するToolの宣言とdispatch。toolPath→handlerをまとめて持ち、
// WS上に届く tools.call を振り分ける（contracts/00004、sync Toolのみ）。

import type { ForwardCallParams, Incoming, RpcError, ToolDeclaration } from "./wire.js";
import { METHOD_CALL } from "./wire.js";

export type ToolHandler = (input: unknown) => unknown | Promise<unknown>;

export interface Tool {
  declaration: ToolDeclaration;
  handler: ToolHandler;
}

export function toolDeclarations(tools: readonly Tool[]): ToolDeclaration[] {
  return tools.map((tool) => tool.declaration);
}

// WS上のrequestを捌くhandlerを作る。tools.call以外のmethodは-32601。
// PluginClientのonRequestにそのまま渡せる形。
export function dispatchToolCall(
  tools: readonly Tool[],
): (message: Incoming) => Promise<{ result?: unknown; error?: RpcError }> {
  const byPath = new Map(tools.map((tool) => [tool.declaration.toolPath, tool]));
  return async (message) => {
    if (message.method !== METHOD_CALL) {
      return { error: { code: -32601, message: "method not found" } };
    }
    const params = message.params as ForwardCallParams;
    if (params === null || typeof params !== "object" || typeof params.toolPath !== "string" || params.toolPath === "") {
      return { error: { code: -32602, message: "invalid params" } };
    }
    const tool = byPath.get(params.toolPath);
    if (!tool) {
      return { error: { code: -32601, message: `unknown toolPath: ${params.toolPath}` } };
    }
    try {
      return { result: await tool.handler(params.input) };
    } catch (error) {
      return { error: { code: -32000, message: String(error) } };
    }
  };
}
