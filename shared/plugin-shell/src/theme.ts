// テーマ（system/light/dark）の適用。systemはOSの明暗に追従する。
// 選択はprefsに入る。
import type { ThemeMode } from "./prefs.ts";

const systemQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

export function applyTheme(mode: ThemeMode): void {
  const resolved = mode === "system" ? (systemQuery().matches ? "dark" : "light") : mode;
  document.documentElement.setAttribute("data-plugumi-theme", resolved);
  // Electron等の宿主がウィンドウ装飾を合わせられるよう、解決後のテーマを
  // DOMイベントでも知らせる。Webでは誰も受けない。
  window.dispatchEvent(new CustomEvent("plugumi:theme", { detail: resolved }));
}

export function resolvedTheme(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? (systemQuery().matches ? "dark" : "light") : mode;
}

let initialized = false;

// 起動時に1回呼ぶ。modeを読む関数を渡し、system追従の変更もここで面倒を見る。
export function initTheme(currentMode: () => ThemeMode): void {
  if (initialized || typeof document === "undefined") return;
  initialized = true;
  applyTheme(currentMode());
  systemQuery().addEventListener("change", () => {
    if (currentMode() === "system") applyTheme("system");
  });
}
