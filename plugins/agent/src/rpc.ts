// JSON-RPC 2.0 over WebSocket の接続層。
// request/response のid相関と、相手からのrequest・notificationの配送を担う。
// Coreへ接続したWSをattachして使う（contracts/00004）。

import { isNotification, isRequest, isResponse } from "./wire.js";
import type { Incoming, RpcError } from "./wire.js";

// WebSocketクライアントをRPC接続に取り付けるための最小IF。
export interface Socket {
  send(data: string): void;
  close(): void;
  onMessage(listener: (data: string) => void): void;
  onClose(listener: () => void): void;
}

type Pending = {
  resolve: (message: Incoming) => void;
  reject: (error: Error) => void;
};

let connectionSequence = 0;

export class Connection {
  // CLIがCoreを切り替えたり再接続したりしても、取消を元のWSに限る。
  private readonly requestIdPrefix = `plugin-${++connectionSequence}-`;
  private seq = 0;
  private pending = new Map<string, Pending>();
  private closed = false;

  onRequest?: (message: Incoming) => Promise<{ result?: unknown; error?: RpcError }>;
  onNotification?: (message: Incoming) => void;
  onClose?: () => void;

  private constructor(private socket: Socket) {
    socket.onMessage((data) => {
      if (this.closed) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      // 契約で分類できないメッセージは破棄できる（contracts/00004）。
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const message = parsed as Incoming;
      if (isRequest(message)) {
        void this.handleRequest(message);
      } else if (isNotification(message)) {
        this.onNotification?.(message);
      } else if (isResponse(message)) {
        const key = JSON.stringify(message.id);
        const entry = this.pending.get(key);
        if (entry) {
          this.pending.delete(key);
          entry.resolve(message);
        }
      }
    });
    socket.onClose(() => {
      this.closed = true;
      for (const entry of this.pending.values())
        entry.reject(new Error("connection closed"));
      this.pending.clear();
      this.onClose?.();
    });
  }

  static attach(socket: Socket): Connection {
    return new Connection(socket);
  }

  close(): void {
    this.closed = true;
    this.socket.close();
  }

  ownsRequestId(id: string): boolean {
    return !this.closed && id.startsWith(this.requestIdPrefix);
  }

  /** request を送り、responseを待つ。 */
  request(method: string, params?: unknown, timeoutMs?: number): Promise<Incoming> {
    if (this.closed) return Promise.reject(new Error("connection closed"));
    const id = `${this.requestIdPrefix}${++this.seq}`;
    return new Promise((resolve, reject) => {
      const key = JSON.stringify(id);
      const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
        this.pending.delete(key);
        reject(new Error("request timed out"));
      }, timeoutMs);
      this.pending.set(key, {
        resolve: (message) => { clearTimeout(timer); resolve(message); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  /** 受け取ったrequestへのresponseを送る。 */
  respond(id: unknown, response: { result?: unknown; error?: RpcError }): void {
    this.send({ jsonrpc: "2.0", id, result: response.result, error: response.error });
  }

  /** notification を送る。 */
  notify(method: string, params?: unknown): boolean {
    return this.send({ jsonrpc: "2.0", method, params });
  }

  private async handleRequest(message: Incoming): Promise<void> {
    try {
      const response = this.onRequest
        ? await this.onRequest(message)
        : { error: { code: -32601, message: "method not found" } };
      this.respond(message.id, response);
    } catch (error) {
      // 例外を応答に変換し、Coreがタイムアウトまで待つのを防ぐ。
      this.respond(message.id, {
        error: { code: -32603, message: String(error) },
      });
    }
  }

  private send(value: object): boolean {
    if (this.closed) return false;
    try {
      this.socket.send(JSON.stringify(value));
      return true;
    } catch {
      // 保留中のrequestはonCloseでまとめて失敗させる。
      return false;
    }
  }
}
