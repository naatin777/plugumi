// tools.call専用のWS接続（registrationIdを付けない/v1/rpc）。
// web pluginのcorerpcパッケージと同じく、接続はCoreごとに1本を使い回し、
// 切れたら次の呼び出しで張り直す。Authorizationヘッダが必要なため
// undiciのglobal WebSocketではなくwsパッケージを使う。
import WebSocket from "ws";

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

// Pool はCoreのURLごとに呼び出し専用Clientを保持する。
export class RpcPool {
  private readonly clients = new Map<string, CallClient>();

  constructor(private readonly token: string | undefined) {}

  for(coreURL: string): CallClient {
    let client = this.clients.get(coreURL);
    if (!client) {
      client = new CallClient(coreURL, this.token);
      this.clients.set(coreURL, client);
    }
    return client;
  }
}

export class CallClient {
  private ws: WebSocket | undefined;
  private connecting: Promise<WebSocket> | undefined;
  private nextId = 0;
  private readonly pending = new Map<string, PendingCall>();

  constructor(
    private readonly coreURL: string,
    private readonly token: string | undefined,
  ) {}

  // call はsync Toolを呼んでresultを返す。JSON-RPC errorはRpcErrorで返す。
  call(registrationId: string, toolPath: string, input: unknown): Promise<unknown> {
    const id = `electron-${++this.nextId}`;
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools.call",
      params: { target: { registrationId, toolPath }, input },
    });
    return this.connection().then(
      (ws) =>
        new Promise((resolve, reject) => {
          this.pending.set(id, { resolve, reject });
          ws.send(request, (error) => {
            if (error) {
              this.pending.delete(id);
              reject(error);
            }
          });
        }),
    );
  }

  private connection(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.ws);
    }
    this.connecting ??= new Promise<WebSocket>((resolve, reject) => {
      const wsURL = this.coreURL.replace(/^http/, "ws") + "/v1/rpc";
      const socket = new WebSocket(wsURL, {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
        handshakeTimeout: 5000,
        maxPayload: 1 << 20,
      });
      socket.once("error", reject);
      socket.once("unexpected-response", (_request, response) => {
        reject(new Error(`GET /v1/rpc: HTTP ${response.statusCode ?? 0}`));
        response.destroy();
        socket.terminate();
      });
      socket.once("close", () => {
        // 接続中に閉じた場合はreject、確立後はdropが待機中を失敗させる。
        reject(new Error("RPC connection closed"));
      });
      socket.once("open", () => {
        socket.removeListener("error", reject);
        this.attach(socket);
        resolve(socket);
      });
    }).finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private attach(socket: WebSocket): void {
    this.ws = socket;
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      let message: { id?: unknown; method?: string; result?: unknown; error?: { code: number; message: string; data?: unknown } };
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      // Responseにはidだけがあり、Notificationにはmethodがある。
      if (typeof message.id !== "string" || message.method !== undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new RpcError(message.error.code, message.error.message, message.error.data));
      } else {
        pending.resolve(message.result);
      }
    });
    socket.once("close", () => this.drop(socket));
  }

  private drop(socket: WebSocket): void {
    if (this.ws !== socket) return;
    this.ws = undefined;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const call of pending) {
      call.reject(new RpcError(-32000, "RPC connection closed"));
    }
  }
}
