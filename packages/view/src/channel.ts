// view channelの確立。viewはhostの仲介なしに自分でCoreへWS接続し、
// ticketでviews.connectを送ってinstanceにbindする（designs/00011）。
// 環境はbrowserのwebviewなので標準のWebSocketを使う
// （Node 22+にも同じglobalがあるためheadlessな検証も可能）。

import type { ViewConnectionInfo } from "./types.js";

const WS_CONNECT_TIMEOUT_MS = 10_000;

// 接続が切れたとき・channelがcloseされたときに以降の送信を止める。
export class ChannelClosedError extends Error {
  constructor() {
    super("view channel is closed");
    this.name = "ChannelClosedError";
  }
}

export class ViewConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ViewConnectError";
  }
}

type MessageHandler = (message: unknown) => void;
type CloseHandler = () => void;

// Channel の内部実装。 genericsはdefineViewが持ち、ここはunknownで扱う。
export class ChannelImpl {
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly closeHandlers = new Set<CloseHandler>();
  // handler未登録の間に届いたmessageのbuffer。
  // connect応答から作者のmountがhandlerを登録するまでのgapを吸収する。
  private buffer: unknown[] = [];
  private closedFlag = false;

  constructor(
    private readonly socket: WebSocket,
    readonly instanceId: string,
  ) {
    socket.addEventListener("message", (event) => {
      if (this.closedFlag || typeof event.data !== "string") return;
      let parsed: { method?: string; params?: { instance?: string; type?: string; payload?: unknown } };
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (parsed.method === "views.message") {
        this.dispatch(parsed.params?.payload);
      } else if (parsed.method === "views.event" && parsed.params?.type === "closed") {
        // runtime死やhost closeでchannelが終わった。WSは残っていても
        // もう何も流れないのでclose扱いにする。
        this.markClosed();
      }
    });
    socket.addEventListener("close", () => this.markClosed());
  }

  private dispatch(payload: unknown): void {
    if (this.messageHandlers.size === 0) {
      this.buffer.push(payload);
      return;
    }
    for (const handler of this.messageHandlers) handler(payload);
  }

  private markClosed(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.buffer = [];
    for (const handler of this.closeHandlers) handler();
  }

  get closed(): boolean {
    return this.closedFlag;
  }

  send(message: unknown): void {
    if (this.closedFlag) throw new ChannelClosedError();
    this.socket.send(JSON.stringify({
      jsonrpc: "2.0",
      method: "views.message",
      params: { instance: this.instanceId, payload: message },
    }));
  }

  onMessage(handler: MessageHandler): () => void {
    const first = this.messageHandlers.size === 0;
    this.messageHandlers.add(handler);
    if (first && this.buffer.length > 0) {
      // 最初のhandler登録でbufferをflushする。以降のmessageはlive配送。
      const pending = this.buffer;
      this.buffer = [];
      for (const payload of pending) handler(payload);
    }
    return () => this.messageHandlers.delete(handler);
  }

  onClose(handler: CloseHandler): () => void {
    if (this.closedFlag) {
      handler();
      return () => {};
    }
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  close(): void {
    if (this.closedFlag) return;
    this.socket.close();
    this.markClosed();
  }
}

// CoreへWS接続しviews.connectでinstanceへbindする。
// 失敗（接続不可・ticket拒否）はViewConnectErrorでrejectする。
export async function connectChannel(connection: ViewConnectionInfo): Promise<ChannelImpl> {
  const url = new URL("/v1/rpc", connection.coreUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new ViewConnectError("connection timed out"));
    }, WS_CONNECT_TIMEOUT_MS);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new ViewConnectError(`could not connect to ${url}`));
    }, { once: true });
  });

  // views.connect — view接続で送るrequestはこれ1つだけなので
  // id相関の機構は持たず、最初に返るresponseをconnectの応答とみなす。
  const instanceId = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new ViewConnectError("views.connect timed out"));
    }, WS_CONNECT_TIMEOUT_MS);
    const listener = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      let parsed: { id?: unknown; result?: { instance?: { id?: string } }; error?: { message?: string } };
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      // responseはmethodを持たない。notificationが先に届くことはない
      // （bind前なのでrouting対象がない）が、念のためidで絞る。
      if (parsed.id !== 1) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", listener);
      if (parsed.error) {
        reject(new ViewConnectError(`views.connect rejected: ${parsed.error.message ?? "unknown error"}`));
        return;
      }
      const id = parsed.result?.instance?.id;
      if (!id) {
        reject(new ViewConnectError("views.connect returned no instance"));
        return;
      }
      resolve(id);
    };
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "views.connect",
      params: { ticket: connection.ticket },
    }));
  });

  return new ChannelImpl(socket, instanceId);
}
