// runtime側のview channel endpoint（designs/00011）。
// instanceが開くとCoreからviews.event openedが届き、onViewで作者へ渡す。
// messageのpayloadはopaqueで、型は作者がshared typeで両端に効かせる。

import type { Connection } from "./rpc.js";

type MessageHandler = (message: unknown) => void;
type CloseHandler = () => void;

// runtimeから見たview channel。view側のChannelと対称で、
// sendはruntime→view方向、onMessageはview→runtime方向。
// 型パラメータは1つのruntimeが複数panelを持ちうるのでchannel単位では
// 効かせず、typed()で作者がpanelごとにnarrowする。
export interface RuntimeViewChannel {
  readonly instanceId: string;
  readonly panelId: string;
  send(message: unknown): void;
  onMessage(handler: MessageHandler): () => void;
  onClose(handler: CloseHandler): () => void;
  readonly closed: boolean;
  // runtime側からchannelを閉じる。Coreはinstanceを閉じてviewへ通知する。
  close(): void;
  // 型付きchannelとしてnarrowするidentity cast。
  // pluginのshared typeに合わせて panelId ごとに使う:
  //   if (channel.panelId === "chat") {
  //     const chat = channel.typed<ViewMessage, RuntimeMessage>();
  //   }
  typed<SendMsg, RecvMsg>(): TypedViewChannel<SendMsg, RecvMsg>;
}

export interface TypedViewChannel<SendMsg, RecvMsg> {
  readonly instanceId: string;
  readonly panelId: string;
  send(message: SendMsg): void;
  onMessage(handler: (message: RecvMsg) => void): () => void;
  onClose(handler: CloseHandler): () => void;
  readonly closed: boolean;
  close(): void;
}

export class RuntimeViewChannelImpl implements RuntimeViewChannel {
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly closeHandlers = new Set<CloseHandler>();
  // 最初のhandler登録までのmessageをbufferする。
  // onView内で同期的に登録すればraceはないが、async setupに備える。
  private buffer: unknown[] = [];
  private closedFlag = false;

  constructor(
    private readonly connection: Connection,
    readonly instanceId: string,
    readonly panelId: string,
  ) {}

  get closed(): boolean {
    return this.closedFlag;
  }

  send(message: unknown): void {
    if (this.closedFlag) throw new Error("view channel is closed");
    this.connection.notify("views.message", { instance: this.instanceId, payload: message });
  }

  onMessage(handler: MessageHandler): () => void {
    const first = this.messageHandlers.size === 0;
    this.messageHandlers.add(handler);
    if (first && this.buffer.length > 0) {
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
    this.connection.notify("views.close", { instance: this.instanceId });
    this.markClosed();
  }

  typed<SendMsg, RecvMsg>(): TypedViewChannel<SendMsg, RecvMsg> {
    return this as unknown as TypedViewChannel<SendMsg, RecvMsg>;
  }

  // Coreからのviews.messageを配送する。handler未登録ならbufferへ。
  dispatch(payload: unknown): void {
    if (this.closedFlag) return;
    if (this.messageHandlers.size === 0) {
      this.buffer.push(payload);
      return;
    }
    for (const handler of this.messageHandlers) handler(payload);
  }

  markClosed(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.buffer = [];
    for (const handler of this.closeHandlers) handler();
  }
}
