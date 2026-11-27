// Electronが提供するoperation。内部ブラウザを持つこと由来のもの —
// webのhostには出せないwindow操作と描画内容の取得だけを置く
// （decisions/00015）。全部terminal応答（contracts/00004）。
import type { Operation } from "@plugumi/runtime";
import type { Windows } from "./windows.js";

// inputの形の最小検査。未知フィールドは無視する（forward compatible）。
function inputObject(input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("input must be an object");
  }
  return input as Record<string, unknown>;
}

function inputWindowId(input: unknown): number {
  const id = inputObject(input).id;
  if (typeof id !== "number" || !Number.isInteger(id)) {
    throw new Error("input.id はwindowのid（整数）が必須です");
  }
  return id;
}

export function windowOperations(windows: Windows): Operation[] {
  return [
    {
      path: "electron/window/list",
      description: "開いているElectron windowの一覧（id・url・title・focused）",
      handle: () => windows.list(),
    },
    {
      path: "electron/window/open",
      description: "新しいwindowを開く。input.pathはhostのroute path（省略時はroot）",
      handle: async (input) => {
        const path = inputObject(input).path;
        if (path !== undefined && (typeof path !== "string" || !path.startsWith("/"))) {
          throw new Error("input.path は / から始まるroute pathです");
        }
        return { id: await windows.open(path as string | undefined) };
      },
    },
    {
      path: "electron/window/close",
      description: "input.idのwindowを閉じる",
      handle: (input) => {
        windows.get(inputWindowId(input)).close();
        return {};
      },
    },
    {
      path: "electron/window/focus",
      description: "input.idのwindowを前面に出す",
      handle: (input) => {
        windows.get(inputWindowId(input)).focus();
        return {};
      },
    },
    {
      path: "electron/window/screenshot",
      description: "input.idのwindowの描画内容をJPEGで返す（id省略時は先頭のwindow）",
      handle: async (input) => {
        const fields = inputObject(input);
        const id = fields.id === undefined
          ? windows.list()[0]?.id
          : inputWindowId(input);
        if (id === undefined) throw new Error("開いているwindowがありません");
        const image = await windows.get(id).webContents.capturePage();
        // CoreのWS受信上限は1MiB（contracts/00004）。PNGだと越えるので、
        // 幅を抑えてJPEGで返す。遠隔確認用途なので可逆性は要らない。
        const scaled = image.getSize().width > 1920
          ? image.resize({ width: 1920 })
          : image;
        const jpeg = scaled.toJPEG(80);
        const { width, height } = scaled.getSize();
        return { imageBase64: jpeg.toString("base64"), mime: "image/jpeg", width, height };
      },
    },
  ];
}
