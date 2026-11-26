// PluginがCoreへ登録するUI bundle（contracts/00004「UIファイルとPanelの宣言」）。
// Coreはファイルをメモリに持つだけなので、登録のたびにmissing確認→不足送信
// →ui置換をやり直す。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface UIPanel {
  panelId: string;
  title: string;
  entry: string;
  styles?: string[];
}

export interface UIFile {
  path: string;
  sha256: string;
  data: Uint8Array;
}

export interface UI {
  files: UIFile[];
  panels: UIPanel[];
}

interface UIManifest {
  files?: { path: string; sha256: string }[];
  panels?: UIPanel[];
}

// loadUI はvite等が出力したUI bundle（plugumi-ui.jsonと参照ファイル群）を
// directoryから読む。manifestのsha256と実際の内容が違えば例外。
export function loadUI(directory: string): UI {
  const manifest = JSON.parse(
    readFileSync(join(directory, "plugumi-ui.json"), "utf8"),
  ) as UIManifest;
  const files = (manifest.files ?? []).map((file) => {
    const data = readFileSync(join(directory, ...file.path.split("/")));
    const sha256 = createHash("sha256").update(data).digest("hex");
    if (sha256 !== file.sha256) {
      throw new Error(`${file.path}: plugumi-ui.jsonのsha256と内容が一致しません`);
    }
    return { path: file.path, sha256, data: new Uint8Array(data) };
  });
  return { files, panels: manifest.panels ?? [] };
}
