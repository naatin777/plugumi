// UI assetのmanifest計算とassets.get応答（contracts/00004「UIファイルとPanelの宣言」）。
// pull model: providerはmanifestを宣言するだけで、内容はCoreが必要時に
// assets.getでfetchする。provider側の手順はこのmoduleが隠蔽する。

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, normalize, relative, sep } from "node:path";

export interface PanelDeclaration {
  panelId: string;
  title: string;
  // rootからの相対パス。GET /v1/ui/{registrationId}/{entry}で配信される。
  entry: string;
  styles?: string[];
}

export interface UI {
  // UI fileのroot directory。この配下の全ファイルがmanifestに載る。
  root: string;
  panels: PanelDeclaration[];
}

export interface UIFileEntry {
  path: string;
  sha256: string;
  size: number;
  // serving用の絶対パス。manifestには出ない。
  absolute: string;
}

export interface UIManifest {
  files: { path: string; sha256: string; size: number }[];
  panels: PanelDeclaration[];
}

// root配下の全ファイルを走査してmanifestを計算する。
export async function scanUI(ui: UI): Promise<{ manifest: UIManifest; files: Map<string, UIFileEntry> }> {
  const files = new Map<string, UIFileEntry>();
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const content = await readFile(absolute);
        const path = relative(ui.root, absolute).split(sep).join("/");
        files.set(path, {
          path,
          sha256: createHash("sha256").update(content).digest("hex"),
          size: content.byteLength,
          absolute,
        });
      }
    }
  }
  await walk(ui.root);
  return {
    manifest: {
      files: [...files.values()].map(({ path, sha256, size }) => ({ path, sha256, size })),
      panels: ui.panels,
    },
    files,
  };
}

// assets.getの応答。pathはmanifestに載ったファイルに限り、
// 内容をbase64で返す。pathの正規化でroot外への脱出を防ぐ。
export async function serveAsset(
  files: Map<string, UIFileEntry>,
  path: string,
): Promise<{ content: string } | { error: { code: number; message: string } }> {
  const normalized = normalize(path).split(sep).join("/");
  const entry = files.get(normalized) ?? files.get(path);
  if (!entry) {
    return { error: { code: -32602, message: `unknown asset path: ${path}` } };
  }
  try {
    const content = await readFile(entry.absolute);
    return { content: content.toString("base64") };
  } catch (error) {
    return { error: { code: -32603, message: String(error) } };
  }
}

// scanUIがrootの存在を前提にするので、panelのentryがfilesに含まれるかの
// 検査はここで行う。宣言と実体のdriftを登録前に潰す。
export function validatePanels(manifest: UIManifest): string | undefined {
  const paths = new Set(manifest.files.map((file) => file.path));
  for (const panel of manifest.panels) {
    if (!paths.has(panel.entry)) {
      return `panel ${panel.panelId}: entry ${panel.entry} is not in the UI root`;
    }
    for (const style of panel.styles ?? []) {
      if (!paths.has(style)) {
        return `panel ${panel.panelId}: style ${style} is not in the UI root`;
      }
    }
  }
  return undefined;
}
