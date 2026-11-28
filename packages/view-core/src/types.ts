// @plugumi/viewの公開型。view作者が見るのはこれとdefineViewだけ。

// hostがmount時にcontextへ入れる接続情報。hostはCoreへinstanceを
// 登録してticketを受け取り、これをviewへ渡すだけで通信には関与しない。
export interface ViewConnectionInfo {
  // CoreのHTTP(S) origin。WSへの変換はSDKが行う。
  coreUrl: string;
  // POST /v1/viewsの応答のticket。views.connectで提示する接続credential。
  ticket: string;
}

// hostがmountへ渡すcontext。connectionはview channelの確立に必須で、
// それ以外はhostが提供するservice。shellによっては無い機能もあるので、
// 作者は存在を前提にしないほうが移植性が高い。
export interface ViewContext {
  connection: ViewConnectionInfo;
  // このviewを開いたときの初期入力。workspaceと一緒に永続化される
  // （「同じものをもう一度開くための情報」であり、編集中の状態ではない）。
  input?: unknown;
  // panelのrestorable state。UIの状態（選択・展開・directory等）を
  // saveStateで書くとworkspaceと一緒に永続化され、reloadや再mountで
  // ここに復元される。編集内容（dirty textなど）は入れない —
  // あくまでUIの状態だけ。JSON直列化できる値に限る。
  state?: unknown;
  saveState?(state: unknown): void;
  // hostのShadowRoot（mountのhostと同じもの）。popover・tooltipなど
  // viewの見た目の一部だが並びの外に置きたい要素はここへappendする。
  root?: ShadowRoot;
  // viewの活動状態をhostへ通知する。意味だけ渡し、表現はhostが決める。
  // 呼ぶたびに全体を置き換える。永続化されず再mountで消える。
  setActivity?(activity: ViewActivity | null): void;
  // 同じleafの隣に、同じpluginの別panelを開く。
  openPanel?(panelId: string, input?: unknown): void;
}

// viewの活動状態。hostはこれを見てheaderやborderに表現を載せる。
export type ViewActivityTone = "neutral" | "info" | "success" | "warning" | "danger";
export type ViewActivitySurface = "header" | "border" | "divider" | "content";
export type ViewActivityEffect = "static" | "flow" | "glow";

// determinateのvalueは0〜1の割合。範囲外はhost側で丸める。
export type ViewActivityProgress =
  | { kind: "determinate"; value: number }
  | { kind: "indeterminate" };

export interface ViewActivityLayer {
  surface: ViewActivitySurface;
  tone: ViewActivityTone;
  effect?: ViewActivityEffect;
}

export interface ViewActivity {
  busy?: boolean;
  progress?: ViewActivityProgress;
  layers?: ViewActivityLayer[];
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
