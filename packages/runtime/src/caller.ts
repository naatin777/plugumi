// caller側の機能: operation invocationとevent追跡（contracts/00004）。
// 呼んだ接続にはCoreがexecutions.eventを自動pushするので、
// executionIdで照合してinvocationごとに配送する。

import type { Connection } from "./rpc.js";

export interface ExecutionRecord {
  id: string;
  operation: string;
  status: string;
  input?: unknown;
  progress?: unknown;
  result?: unknown;
  error?: { code: string; message: string; kind?: string };
}

export interface ExecutionsEventParams {
  executionId: string;
  seq: number;
  type: string;
  payload?: unknown;
}

export function isTerminalStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

// executionIdで照合されるeventの配送先。terminal eventで登録を外す。
export class InvocationEvents {
  private readonly listeners = new Map<string, (event: ExecutionsEventParams) => void>();

  // notificationを対応するinvocationへ配送する。登録がなければ捨てる。
  route(params: ExecutionsEventParams): void {
    const listener = this.listeners.get(params.executionId);
    if (!listener) return;
    listener(params);
    if (params.type === "result" || params.type === "error") {
      this.listeners.delete(params.executionId);
    }
  }

  follow(executionId: string, listener: (event: ExecutionsEventParams) => void): void {
    this.listeners.set(executionId, listener);
  }

  drop(executionId: string): void {
    this.listeners.delete(executionId);
  }
}

// operations.invokeを送り、応答のExecutionを返す。
// onEventを渡すと以降のexecutions.eventがterminalまで届く。
export async function invokeOperation(
  connection: Connection,
  events: InvocationEvents,
  operation: string,
  input?: unknown,
  onEvent?: (event: ExecutionsEventParams) => void,
): Promise<ExecutionRecord> {
  const response = await connection.request("operations.invoke", { operation, input }, 130_000);
  if (response.error) {
    throw new Error(response.error.message);
  }
  const execution = (response.result as { execution?: ExecutionRecord } | undefined)?.execution;
  if (!execution) {
    throw new Error("invoke response did not contain an execution");
  }
  if (onEvent && !isTerminalStatus(execution.status)) {
    events.follow(execution.id, onEvent);
  }
  return execution;
}

// executions.cancelを送り、受理時点のExecutionを返す。
export async function cancelExecution(
  connection: Connection,
  executionId: string,
): Promise<ExecutionRecord> {
  const response = await connection.request("executions.cancel", { executionId }, 10_000);
  if (response.error) {
    throw new Error(response.error.message);
  }
  return response.result as ExecutionRecord;
}
