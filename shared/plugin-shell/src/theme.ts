// テーマ（dark/light/system）の適用。選択はlocalStorageに残り、
// systemのときはOSの明暗に追従する。
import { loadTheme, saveTheme, type ThemeMode } from "./storage";

const systemQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

export function applyTheme(mode: ThemeMode): void {
  saveTheme(mode);
  const resolved = mode === "system" ? (systemQuery().matches ? "dark" : "light") : mode;
  document.documentElement.setAttribute("data-plugumi-theme", resolved);
  // Electron等の宿主がウィンドウ装飾（titleBarOverlay）を合わせられるよう、
  // 解決後のテーマをDOMイベントでも知らせる。Webでは誰も受けない。
  window.dispatchEvent(new CustomEvent("plugumi:theme", { detail: resolved }));
}

let initialized = false;
export function initTheme(): void {
  if (initialized || typeof document === "undefined") return;
  initialized = true;
  applyTheme(loadTheme());
  systemQuery().addEventListener("change", () => {
    if (loadTheme() === "system") applyTheme("system");
  });
}
