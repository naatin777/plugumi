// @plugumi/viewの公開型。view作者が見るのはこれとdefineViewだけ。

// hostがmount時にcontextへ入れる接続情報。hostはCoreへinstanceを
// 登録してticketを受け取り、これをviewへ渡すだけで通信には関与しない。
export interface ViewConnectionInfo {
  // CoreのHTTP(S) origin。WSへの変換はSDKが行う。
  coreUrl: string;
  // POST /v1/viewsの応答のticket。views.connectで提示する接続credential。
  ticket: string;
}

// hostがmountへ渡すcontext。接続情報以外にもhost固有の情報
// （開くときの初期入力など）が載りうるが、SDKが要求するのはconnectionだけ。
export interface ViewContext {
  connection: ViewConnectionInfo;
  input?: unknown;
}

// view⇄runtime間の型付きchannel。payloadはopaqueでCoreは中身を見ず、
// 型はplugin作者がshared typeで両端に効かせる（designs/00011）。
// SendMsgはview→runtime方向、RecvMsgはruntime→view方向。
export interface Channel<SendMsg, RecvMsg> {
  // runtimeへmessageを送る。close後はChannelClosedErrorを投げる。
  send(message: SendMsg): void;
  // message handlerを登録する。戻り値の関数で解除できる。
  // connect応答から最初の登録までに届いたmessageはbufferされ、
  // 最初の登録時にまとめてflushされる（mount直後の取りこぼしがない）。
  onMessage(handler: (message: RecvMsg) => void): () => void;
  // channelの終了（runtime死・host close・view側close）を知る。
  // 既にclose済みなら即座に呼ばれる。
  onClose(handler: () => void): () => void;
  readonly closed: boolean;
  // view側からchannelを閉じる。WSを閉じ、Coreはinstanceをclosedにして
  // runtimeへ通知する。
  close(): void;
}

// mountの戻り値。destroyはunmount時にshellが呼ぶ。
export interface ViewHandle {
  destroy(): void;
}
