// JSON-RPC 2.0 over WebSocket の接続層。
// request/response のid相関と、相手からのrequest・notificationの配送を担う。
// 同一conn上で両方向にrequestを飛ばすので、送るidにはprefixを付ける
// （docs/contracts/00003「idの一意性」）。
// WS clientはNode 24のnative WebSocketを使う。

import { isNotif, isRequest, isResponse } from "./wire.js";
import type { Incoming, RpcError } from "./wire.js";

type Pending = {
  resolve: (message: Incoming) => void;
  reject: (error: Error) => void;
};

export class Conn {
  private seq = 0;
  private pending = new Map<string, Pending>();

  onRequest?: (message: Incoming) => Promise<{ result?: unknown; error?: RpcError }>;
  onNotif?: (message: Incoming) => void;
  onClose?: () => void;

  private constructor(private socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      let message: Incoming;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (isRequest(message)) {
        void this.handleRequest(message);
      } else if (isNotif(message)) {
        this.onNotif?.(message);
      } else if (isResponse(message)) {
        const key = JSON.stringify(message.id);
        const entry = this.pending.get(key);
        if (entry) {
          this.pending.delete(key);
          entry.resolve(message);
        }
      }
    });
    socket.addEventListener("close", () => {
      for (const entry of this.pending.values())
        entry.reject(new Error("conn closed"));
      this.pending.clear();
      this.onClose?.();
    });
  }

  static connect(url: string): Promise<Conn> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => resolve(new Conn(socket)), { once: true });
      socket.addEventListener("error", () => reject(new Error("ws connect failed")), {
        once: true,
      });
    });
  }

  private nextId(): string {
    return `p-${++this.seq}`;
  }

  /** request を送り、responseを待つ。 */
  request(method: string, params?: unknown): Promise<Incoming> {
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      this.pending.set(JSON.stringify(id), { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  /** 受け取ったrequestへのresponseを送る。 */
  respond(id: unknown, result: { result?: unknown; error?: RpcError }): void {
    this.send({ jsonrpc: "2.0", id, result: result.result, error: result.error });
  }

  /** notification を送る。 */
  notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private async handleRequest(message: Incoming): Promise<void> {
    if (!this.onRequest) {
      this.respond(message.id, { error: { code: -32601, message: "method not found" } });
      return;
    }
    const response = await this.onRequest(message);
    this.respond(message.id, response);
  }

  private send(value: object): void {
    this.socket.send(JSON.stringify(value));
  }
}
