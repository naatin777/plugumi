// Panel宣言のstylesをCore経由で取り、Panel InstanceのShadowRootへ
// adoptedStyleSheetsで入れる（contracts/00005「CSS」）。
// @font-faceだけはshadow内では登録できないためdocumentへ出し、
// rid+shaで共有する。共有分は参照カウントで管理し、その登録の
// Instanceが全て閉じたら外す。
import type { PluginPanelEntry, Host } from "../host.tsx";

// 1回のmountで用意するstyle。sheetは呼び側がshadow rootへadoptし、
// releaseは@font-faceの共有参照を手放す。
export interface PanelStyles {
  sheet: CSSStyleSheet;
  release(): void;
}

interface FontFaces {
  element: HTMLStyleElement;
  refs: number;
}

// keyは `<registrationId>:<uiSha256>`。shaが変われば別共有として
// 載せ直し、古い方は参照が尽きた時点で外れる。
const installed = new Map<string, FontFaces>();

async function fetchText(
  host: Host, coreKey: string, panel: PluginPanelEntry,
): Promise<string> {
  const parts: string[] = [];
  for (const path of panel.styles ?? []) {
    const response = await fetch(
      host.uiURL(coreKey, panel.registrationId, path, panel.uiSha256),
    );
    if (!response.ok) throw new Error(`styles ${path}: HTTP ${response.status}`);
    parts.push(await response.text());
  }
  return parts.join("\n");
}

// 生CSSを振り分ける。@importはreplaceSyncが受理しないので警告して落とす。
// @font-faceはdocument側へ出す分としてsheetから抜く。それ以外
// （@keyframesを含む全て）はshadow内で閉じるのでsheetに残す。
function splitFontFaces(registrationId: string, text: string): {
  sheet: CSSStyleSheet;
  fontFaces: string;
} {
  if (/@import/.test(text)) {
    console.warn(`[plugumi] @import in styles of ${registrationId} is ignored`);
    text = text.replace(/@import[^;]*;/g, "");
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  const fontFaces: string[] = [];
  for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
    const rule = sheet.cssRules[i];
    // 規則種の定数は全環境で揃っていないため、class名で判定する。
    if (rule.constructor.name === "CSSFontFaceRule") {
      fontFaces.unshift(rule.cssText);
      sheet.deleteRule(i);
    }
  }
  return { sheet, fontFaces: fontFaces.join("\n") };
}

// その登録のstyleを用意して、shadowへadoptするsheetと、@font-faceの
// 共有参照を手放すreleaseを返す。
export async function acquirePanelStyles(
  host: Host, coreKey: string, panel: PluginPanelEntry,
): Promise<PanelStyles> {
  const { sheet, fontFaces } = splitFontFaces(
    panel.registrationId,
    await fetchText(host, coreKey, panel),
  );
  if (!fontFaces) return { sheet, release() {} };
  const key = `${panel.registrationId}:${panel.uiSha256}`;
  const existing = installed.get(key);
  if (existing) {
    existing.refs++;
    return { sheet, release: () => release(key) };
  }
  const element = document.createElement("style");
  element.dataset.plugumiFonts = key;
  element.textContent = fontFaces;
  document.head.append(element);
  installed.set(key, { element, refs: 1 });
  return { sheet, release: () => release(key) };
}

function release(key: string) {
  const entry = installed.get(key);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    entry.element.remove();
    installed.delete(key);
  }
}
