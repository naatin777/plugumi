// JSON-RPC 2.0 over WebSocket の接続層。
// request/response のid相関と、相手からのrequest・notificationの配送を担う。
// 同一conn上で両方向にrequestを飛ばすので、送るidにはprefixを付ける
// （docs/contracts/00003「idの一意性」）。
// WS clientはNode 24のnative WebSocketを使う。

import { isNotif, isRequest, isResponse } from "./wire.js";
import type { Incoming, RpcError } from "./wire.js";

type Pending = { resolve: (m: Incoming) => void; reject: (e: Error) => void };

export class Conn {
  private seq = 0;
  private pending = new Map<string, Pending>();

  onRequest?: (m: Incoming) => Promise<{ result?: unknown; error?: RpcError }>;
  onNotif?: (m: Incoming) => void;
  onClose?: () => void;

  private constructor(private ws: WebSocket) {
    ws.addEventListener("message", (ev) => {
      let inMsg: Incoming;
      try {
        inMsg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (isRequest(inMsg)) {
        void this.handleRequest(inMsg);
      } else if (isNotif(inMsg)) {
        this.onNotif?.(inMsg);
      } else if (isResponse(inMsg)) {
        const key = JSON.stringify(inMsg.id);
        const p = this.pending.get(key);
        if (p) {
          this.pending.delete(key);
          p.resolve(inMsg);
        }
      }
    });
    ws.addEventListener("close", () => {
      for (const p of this.pending.values()) p.reject(new Error("conn closed"));
      this.pending.clear();
      this.onClose?.();
    });
  }

  static connect(url: string): Promise<Conn> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new Conn(ws)), { once: true });
      ws.addEventListener("error", (e) => reject(new Error(`ws error: ${e}`)), { once: true });
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

  private async handleRequest(m: Incoming): Promise<void> {
    if (!this.onRequest) {
      this.respond(m.id, { error: { code: -32601, message: "method not found" } });
      return;
    }
    const res = await this.onRequest(m);
    this.respond(m.id, res);
  }

  private send(v: object): void {
    this.ws.send(JSON.stringify(v));
  }
}
