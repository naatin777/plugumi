// @plugumi/view: plugin view作者向けSDK（designs/00011）。
// viewはCoreプロトコルを知らない — 知るのは自分のruntimeと
// hostが注入する接続情報だけで、接続・bind・cleanupはdefineViewが担う。

import { connectChannel, type ChannelImpl } from "./channel.js";
import type { Channel, ViewContext, ViewHandle } from "./types.js";

export type {
  Channel, ViewContext, ViewConnectionInfo, ViewHandle,
  ViewActivity, ViewActivityTone, ViewActivitySurface, ViewActivityEffect,
  ViewActivityProgress, ViewActivityLayer,
} from "./types.js";
export { ChannelClosedError, ViewConnectError } from "./channel.js";

// 作者のmount関数。hostはShadowRoot、channelは接続済み・型付きで渡る。
// Ctxはhost固有のcontext拡張（shell service等）を効かせるための型で、
// 既定は標準のViewContext。
export type ViewMount<SendMsg, RecvMsg, Ctx extends ViewContext = ViewContext> = (
  host: ShadowRoot,
  channel: Channel<SendMsg, RecvMsg>,
  context: Ctx,
) => ViewHandle | Promise<ViewHandle> | void;

// view entryを作る。作者のmountを包み、
//   1. contextの接続情報からCoreへWS接続しviews.connectでbind
//   2. 接続済みの型付きchannelを作者のmountへ渡す
//   3. unmount時にchannel（WS）のcloseまで面倒を見る
// を自動で行う。接続に失敗した場合はmount自体がrejectされ、
// 作者のコードは呼ばれない。
export function defineView<SendMsg = unknown, RecvMsg = unknown, Ctx extends ViewContext = ViewContext>(
  mount: ViewMount<SendMsg, RecvMsg, Ctx>,
): (host: ShadowRoot, context: ViewContext) => Promise<ViewHandle> {
  return async (host, context) => {
    const impl = await connectChannel(context.connection);
    const channel = impl as unknown as Channel<SendMsg, RecvMsg>;
    const handle = (await mount(host, channel, context as Ctx)) ?? { destroy() {} };
    return {
      destroy() {
        // 作者のcleanupを先に呼ぶ — 最後のmessageを送る余地を残す。
        handle.destroy();
        impl.close();
      },
    };
  };
}

// 内部実装の型をtest等から触れるようにexportしておく（公開APIではない）。
export type { ChannelImpl };
