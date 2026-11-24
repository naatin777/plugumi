// Electronが提供するTool。内部ブラウザを持つこと由来のもの —
// webのhostには出せないwindow操作と描画内容の取得だけを置く
// （decisions/00015）。
import type { Tool } from "plugumi-plugin-client";
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

export function windowTools(windows: Windows): Tool[] {
  return [
    {
      declaration: {
        toolPath: "electron/window/list",
        kind: "sync",
        description: "開いているElectron windowの一覧（id・url・title・focused）",
      },
      handler: () => windows.list(),
    },
    {
      declaration: {
        toolPath: "electron/window/open",
        kind: "sync",
        description: "新しいwindowを開く。input.pathはhostのroute path（省略時はroot）",
      },
      handler: async (input) => {
        const path = inputObject(input).path;
        if (path !== undefined && (typeof path !== "string" || !path.startsWith("/"))) {
          throw new Error("input.path は / から始まるroute pathです");
        }
        return { id: await windows.open(path as string | undefined) };
      },
    },
    {
      declaration: {
        toolPath: "electron/window/close",
        kind: "sync",
        description: "input.idのwindowを閉じる",
      },
      handler: (input) => {
        windows.get(inputWindowId(input)).close();
        return {};
      },
    },
    {
      declaration: {
        toolPath: "electron/window/focus",
        kind: "sync",
        description: "input.idのwindowを前面に出す",
      },
      handler: (input) => {
        windows.get(inputWindowId(input)).focus();
        return {};
      },
    },
    {
      declaration: {
        toolPath: "electron/window/screenshot",
        kind: "sync",
        description: "input.idのwindowの描画内容をPNGで返す（id省略時は先頭のwindow）",
      },
      handler: async (input) => {
        const fields = inputObject(input);
        const id = fields.id === undefined
          ? windows.list()[0]?.id
          : inputWindowId(input);
        if (id === undefined) throw new Error("開いているwindowがありません");
        const image = await windows.get(id).webContents.capturePage();
        const png = image.toPNG();
        const { width, height } = image.getSize();
        return { pngBase64: png.toString("base64"), width, height };
      },
    },
  ];
}
