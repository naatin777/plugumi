// running状態のoperation実行がCoreへeventを送るためのhandleと、
// cancel配送の照合（contracts/00004）。

import type { Connection } from "./rpc.js";
import { METHOD_OPERATIONS_EVENT } from "./wire.js";

// session内のrunning executionのcancel配送先。executionIdで照合する。
// WS切断時はconnectionのcloseで全て終わるので、こちらは明示cancel専用。
export class ActiveExecutions {
  private readonly cancellations = new Map<string, () => void>();

  register(executionId: string, onCancel: () => void): void {
    this.cancellations.set(executionId, onCancel);
  }

  deregister(executionId: string): void {
    this.cancellations.delete(executionId);
  }

  // Coreからのexecutions.cancel notificationを配送する。
  cancel(executionId: string): void {
    this.cancellations.get(executionId)?.();
  }
}

export class Execution {
  private seq = 0;
  private terminal = false;
  private readonly cancelPromise: Promise<void>;
  private cancelResolve!: () => void;

  constructor(
    private readonly connection: Connection,
    active: ActiveExecutions,
    readonly id: string,
    readonly operation: string,
    readonly input: unknown,
  ) {
    this.cancelPromise = new Promise((resolve) => {
      this.cancelResolve = resolve;
    });
    active.register(id, () => this.cancelResolve());
  }

  // Coreからのcancel要求。handlerはこれを待って仕事を止め、
  // cancel()で終端eventを送る。
  get cancelled(): Promise<void> {
    return this.cancelPromise;
  }

  // RPC接続の切断。接続が切れたらCore側でExecutionは
  // providerDisconnectedとしてfailedになるので、handlerは
  // これを検知して仕事を止める。終端eventは届かないので送らない。
  get disconnected(): Promise<void> {
    return this.connection.closed;
  }

  // 途中経過を送る。payloadの形はoperationの私物で、
  // streamSchemaの宣言に対応させるのはplugin側の責任。
  progress(payload: unknown): void {
    this.event("progress", payload);
  }

  // 終端のresult eventを送る。これでExecutionはsucceededになる。
  result(result: unknown): void {
    this.event("result", result);
    this.terminal = true;
  }

  // 終端のerror eventを送る。これでExecutionはfailedになる。
  error(message: string, code = "execution_failed"): void {
    this.event("error", { code, message });
    this.terminal = true;
  }

  // cancelされて終わったときの終端event。Core側でcancelled statusになる。
  cancel(): void {
    this.event("error", { code: "cancelled", message: "cancelled by caller" });
    this.terminal = true;
  }

  get finished(): boolean {
    return this.terminal;
  }

  private event(type: string, payload: unknown): void {
    this.seq += 1;
    this.connection.notify(METHOD_OPERATIONS_EVENT, {
      executionId: this.id,
      seq: this.seq,
      type,
      payload,
    });
  }
}
