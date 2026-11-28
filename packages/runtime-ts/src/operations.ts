// operationの定義と呼び出し配送。実行の形は2つ（contracts/00004）:
//
// - handle: 結果（またはthrow）をinvoke応答で直接返すterminal実行。
//   短時間で終わるもの。
// - stream: {status:"running"}を応答で返し、進行・終端はExecution経由の
//   operations.eventで送る。長時間・streamのあるもの。
//
// どちらか一方だけを持つ。wire上の宣言にkindは出ない — 実行形態は
// plugin内部の実装詳細であって公開契約ではない。

import { ActiveExecutions, Execution } from "./execution.js";
import type { Connection } from "./rpc.js";
import type { ForwardInvokeParams, OperationDeclaration, RpcError } from "./wire.js";

export interface TerminalOperation {
  path: string;
  description?: string;
  inputSchema?: object;
  resultSchema?: object;
  handle: (input: unknown) => Promise<unknown> | unknown;
}

export interface StreamOperation {
  path: string;
  description?: string;
  inputSchema?: object;
  streamSchema?: object;
  resultSchema?: object;
  // Execution経由でprogress/result/error/cancelを送る。
  // cancelはexec.cancelled、切断はexec.disconnectedで検知する。
  stream: (execution: Execution) => void;
}

export type Operation = TerminalOperation | StreamOperation;

export function isStreamOperation(operation: Operation): operation is StreamOperation {
  return "stream" in operation;
}

export function declarations(operations: readonly Operation[]): OperationDeclaration[] {
  return operations.map((operation) => ({
    path: operation.path,
    description: operation.description,
    inputSchema: operation.inputSchema,
    streamSchema: "streamSchema" in operation ? operation.streamSchema : undefined,
    resultSchema: operation.resultSchema,
  }));
}

// 着信operations.invokeを捌き、応答値を返す。
// handlerの形でterminal/running応答を分ける。
export async function dispatchInvoke(
  active: ActiveExecutions,
  connection: Connection,
  operations: readonly Operation[],
  params: ForwardInvokeParams,
): Promise<{ result?: unknown; error?: RpcError }> {
  const operation = operations.find((candidate) => candidate.path === params.operation);
  if (!operation) {
    return { error: { code: -32601, message: `unknown operation: ${params.operation}` } };
  }
  const execution = new Execution(
    connection,
    active,
    params.executionId,
    params.operation,
    params.input,
  );
  if (isStreamOperation(operation)) {
    operation.stream(execution);
    return { result: { status: "running" } };
  }
  try {
    const result = await operation.handle(params.input);
    return { result: { status: "succeeded", result } };
  } catch (error) {
    return {
      result: {
        status: "failed",
        error: {
          code: "execution_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
}

export function invalidParams(error: string): { error: RpcError } {
  return { error: { code: -32602, message: error } };
}
