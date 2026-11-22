// Panel宣言のstylesをCore経由で取り、その登録のsubtreeにだけ当たる
// <style>としてheadへ出す（Shadow DOMは使わず@scopeで隔離する）。
// 参照カウントで管理し、その登録のInstanceが全て閉じたら外す。
import type { PanelEntry, ShellHost } from "../host";

interface ScopedStyles {
  element: HTMLStyleElement;
  uiSha256: string;
  refs: number;
  // 同じsha256で取り直した内容。fetchが走るのはinstall/updateのときだけ。
  text: string;
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
  // @media/@supports/@layer/@containerなどのグループ規則は中身ごとscopeへ、
  // @keyframes/@font-faceのように名前で結合する規則は外へそのまま出す。
  // 定数が無い規則種（@container等）もあるため判定はclass名で行う。
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

async function buildScoped(host: ShellHost, registrationId: string, coreKey: string, styles: string[], uiSha256: string): Promise<string> {
  const parts: string[] = [];
  for (const path of styles) {
    const response = await fetch(
      host.uiURL(coreKey, registrationId, path, uiSha256),
    );
    if (!response.ok) throw new Error(`styles ${path}: HTTP ${response.status}`);
    parts.push(await response.text());
  }
  return scopeCSS(registrationId, parts.join("\n"));
}

// その登録のstyleを用意して参照を1つ返す。同じrid+shaは使い回し、
// shaが変わっていれば中身を取り直して差し替える。
export async function acquirePanelStyles(host: ShellHost, coreKey: string, panel: PanelEntry): Promise<() => void> {
  const rid = panel.registrationId;
  const existing = installed.get(rid);
  if (existing) {
    existing.refs++;
    if (existing.uiSha256 !== panel.uiSha256) {
      existing.text = await buildScoped(host, rid, coreKey, panel.styles, panel.uiSha256);
      existing.element.textContent = existing.text;
      existing.element.dataset.uiSha256 = panel.uiSha256;
      existing.uiSha256 = panel.uiSha256;
    }
    return () => release(rid);
  }
  const text = await buildScoped(host, rid, coreKey, panel.styles, panel.uiSha256);
  const element = document.createElement("style");
  element.dataset.plugumiStyles = rid;
  element.dataset.uiSha256 = panel.uiSha256;
  element.textContent = text;
  document.head.append(element);
  installed.set(rid, { element, uiSha256: panel.uiSha256, refs: 1, text });
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
