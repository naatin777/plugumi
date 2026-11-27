// Plugin Shell（リポジトリ内専用の画面共有物）。利用側のVite+vite pluginが
// そのままコンパイルするため、srcを直接exportする。
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-mono/700.css";
// cascade layerの宣言順は最初の読み込みが効くので、layerの宣言を先頭に置く。
// componentの*.module.cssは描くcomponent自身がimportする。
import "./styles/layers.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";

export type {
  ShellHost, CoreEntry, PanelEntry, PluginPanelEntry, BuiltinPanelEntry,
  AreaTree, ProjectTree, InvokeBody, ViewTicket, RegistrationEntry,
  PanelContext, PanelHandle, PanelMount,
} from "./host.tsx";
export { ShellHostContext, ShellHostProvider, useShellHost } from "./host.tsx";
export { shellRoutes } from "./routes.tsx";
export { initTheme } from "./theme.ts";
export { loadPrefs } from "./prefs.ts";
export type { WorkspaceState, PanelRef } from "./layout/model.ts";
