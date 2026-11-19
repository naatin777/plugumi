// JSON-RPC 2.0 over WebSocket の接続層。
// request/response のid相関と、相手からのrequest・notificationの配送を担う。
// 同一connection上で両方向にrequestを飛ばすので、送るidにはprefixを付ける
// （docs/contracts/00003「idの一意性」）。
//
// Pluginは接続を開始しない。CoreがupgradeしたWSをattachして使う。

import { isNotification, isRequest, isResponse } from "./wire.js";
import type { Incoming, RpcError } from "./wire.js";

// WebSocket実装差を吸収する最小IF。Core側がupgradeした
// socket（wsパッケージのWebSocket等）をlink.tsがこの形に包んで渡す。
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

export class Connection {
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
      // 契約で分類できないメッセージは破棄できる（contracts/00002）。
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

  private nextId(): string {
    return `plugin-${++this.seq}`;
  }

  /** request を送り、responseを待つ。 */
  request(method: string, params?: unknown, timeoutMs?: number): Promise<Incoming> {
    if (this.closed) return Promise.reject(new Error("connection closed"));
    const id = this.nextId();
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
  notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private async handleRequest(message: Incoming): Promise<void> {
	try {
		const response = this.onRequest
			? await this.onRequest(message)
			: { error: { code: -32601, message: "method not found" } };
		this.respond(message.id, response);
	} catch (error) {
		// onRequestのrejectをそのままにするとunhandled rejectionになり、
		// Nodeの既定ではprocessごと落ちる。requestには必ず応答を返す
		// （contracts/00002。Coreは応答なしを120s timeoutまで待つ）。
		try {
			this.respond(message.id, {
				error: { code: -32603, message: String(error) },
			});
		} catch {
			// socketが既に死んでいる場合。onClose側の後始末に任せる。
		}
	}
  }

  private send(value: object): void {
	if (this.closed) return;
	try {
		this.socket.send(JSON.stringify(value));
	} catch {
		// 切断済みsocketへのsend失敗はonCloseのpending rejectで
		// 回収されるため、ここでは握り潰す（send失敗で呼び出し側の
		// promiseをrejectさせるとrequest()のpendingが残る）。
	}
  }
}
