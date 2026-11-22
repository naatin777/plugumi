// Plugin Shell 一式の入口。importするだけでフォント・Token・画面CSSと
// Darkテーマのdata属性が入る。
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-sans-jp/400.css";
import "@fontsource/ibm-plex-sans-jp/700.css";
import "@fontsource/m-plus-1-code/latin-400.css";
import "@fontsource/m-plus-1-code/latin-700.css";
import "@fontsource/m-plus-1-code/japanese-400.css";
import "@fontsource/m-plus-1-code/japanese-700.css";

import "./styles/tokens.css";
import "./index.css";

// テーマ切替UIは今回持たない。Dark固定。
if (typeof document !== "undefined") {
  document.documentElement.setAttribute("data-plugumi-theme", "dark");
}

export * from "./host";
export { ShellRoutes } from "./routes";
