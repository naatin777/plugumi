// Panel宣言のstylesをCore経由で取り、その登録のsubtreeにだけ当たる
// <style>としてheadへ出す（contracts/00005「CSS」）。
// Shadow DOMは使わず@scopeで隔離する。参照カウントで管理し、
// その登録のInstanceが全て閉じたら外す。uiSha256が変われば取り直す。
import type { PluginPanelEntry, ShellHost } from "../host.tsx";

interface ScopedStyles {
  element: HTMLStyleElement;
  uiSha256: string;
  refs: number;
}

const installed = new Map<string, ScopedStyles>();

// 生CSSを@scope付きに組み直す。CSSStyleRuleとグループ規則は
// `@scope ([data-plugumi-plugin="<rid>"]) to ([data-plugumi-plugin])` の中へ、
// @keyframes・@font-faceなどの名前で結合する規則は外へそのまま出す。
export function scopeCSS(registrationId: string, text: string): string {
  // @importはreplaceSyncが受理しない。外へ出しても意図どおり読めないので落とす。
  if (/@import/.test(text)) {
    console.warn(`[plugumi] @import in styles of ${registrationId} is ignored`);
    text = text.replace(/@import[^;]*;/g, "");
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  const scoped: string[] = [];
  const outer: string[] = [];
  // 規則種の定数は全環境で揃っていない（@container等）ため、class名で判定する。
  const inside = new Set([
    "CSSStyleRule", "CSSMediaRule", "CSSSupportsRule",
    "CSSLayerBlockRule", "CSSContainerRule", "CSSScopeRule",
  ]);
  for (const rule of sheet.cssRules) {
    (inside.has(rule.constructor.name) ? scoped : outer).push(rule.cssText);
  }
  const prelude = `@scope ([data-plugumi-plugin="${registrationId}"]) to ([data-plugumi-plugin])`;
  const inner = scoped.join("\n");
  return outer.join("\n") + (inner ? `\n${prelude} {\n${inner}\n}` : "");
}

async function fetchScoped(
  host: ShellHost, coreKey: string, panel: PluginPanelEntry,
): Promise<string> {
  const parts: string[] = [];
  for (const path of panel.styles) {
    const response = await fetch(
      host.uiURL(coreKey, panel.registrationId, path, panel.uiSha256),
    );
    if (!response.ok) throw new Error(`styles ${path}: HTTP ${response.status}`);
    parts.push(await response.text());
  }
  return scopeCSS(panel.registrationId, parts.join("\n"));
}

// その登録のstyleを用意して参照を1つ返す。同じrid+shaは使い回し、
// shaが変わっていれば中身を取り直して差し替える。
export async function acquirePanelStyles(
  host: ShellHost, coreKey: string, panel: PluginPanelEntry,
): Promise<() => void> {
  const rid = panel.registrationId;
  const existing = installed.get(rid);
  if (existing) {
    existing.refs++;
    if (existing.uiSha256 !== panel.uiSha256) {
      const text = await fetchScoped(host, coreKey, panel);
      existing.element.textContent = text;
      existing.element.dataset.uiSha256 = panel.uiSha256;
      existing.uiSha256 = panel.uiSha256;
    }
    return () => release(rid);
  }
  const text = await fetchScoped(host, coreKey, panel);
  const element = document.createElement("style");
  element.dataset.plugumiStyles = rid;
  element.dataset.uiSha256 = panel.uiSha256;
  element.textContent = text;
  document.head.append(element);
  installed.set(rid, { element, uiSha256: panel.uiSha256, refs: 1 });
  return () => release(rid);
}

function release(registrationId: string) {
  const entry = installed.get(registrationId);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    entry.element.remove();
    installed.delete(registrationId);
  }
}
