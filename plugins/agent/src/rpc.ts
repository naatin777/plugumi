// JSON-RPC 2.0 over WebSocket の接続層。
// request/response のid相関と、相手からのrequest・notificationの配送を担う。
// 同一conn上で両方向にrequestを飛ばすので、送るidにはprefixを付ける
// （docs/contracts/00003「idの一意性」）。
//
// Pluginは接続を開始しない。CoreがupgradeしたWSをattachして使う。

import { isNotif, isRequest, isResponse } from "./wire.js";
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

export class Conn {
  private seq = 0;
  private pending = new Map<string, Pending>();

  onRequest?: (message: Incoming) => Promise<{ result?: unknown; error?: RpcError }>;
  onNotif?: (message: Incoming) => void;
  onClose?: () => void;

  private constructor(private socket: Socket) {
    socket.onMessage((data) => {
      let message: Incoming;
      try {
        message = JSON.parse(data);
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
    socket.onClose(() => {
      for (const entry of this.pending.values())
        entry.reject(new Error("conn closed"));
      this.pending.clear();
      this.onClose?.();
    });
  }

  static attach(socket: Socket): Conn {
    return new Conn(socket);
  }

  close(): void {
    this.socket.close();
  }

  private nextId(): string {
    return `plugin-${++this.seq}`;
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
	try {
		this.socket.send(JSON.stringify(value));
	} catch {
		// 切断済みsocketへのsend失敗はonCloseのpending rejectで
		// 回収されるため、ここでは握り潰す（send失敗で呼び出し側の
		// promiseをrejectさせるとrequest()のpendingが残る）。
	}
  }
}
