// editor view ↔ runtime のchannel message型。wireはopaqueなので
// 型はこの共有ファイルが正本（view channelの作法）。
export type ViewMessage =
  | { type: "read"; path: string }
  | { type: "write"; path: string; content: string };

export type RuntimeMessage =
  | { type: "content"; path: string; content: string }
  | { type: "saved"; path: string }
  | { type: "error"; message: string };
