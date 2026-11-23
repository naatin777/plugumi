// Plugin Shell（リポジトリ内専用の画面共有物）。利用側のVite+vite pluginが
// そのままコンパイルするため、srcを直接exportする。
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
import "./shell/shell.css";
import "./shell/controls.css";
import "./shell/title-tools.css";
import "./shell/tab-strip.css";
import "./shell/panel-mount.css";
import "./shell/resizer.css";
import "./shell/dock.css";
import "./shell/pinned.css";
import "./shell/center.css";
import "./shell/pages.css";
import "./shell/sidebar.css";
import "./shell/activity.css";
import "./pages/lab.css";

export type {
  ShellHost, CoreEntry, PanelEntry, AreaTree, ProjectTree, CallToolBody,
} from "./host.tsx";
export { ShellHostContext, ShellHostProvider, useShellHost } from "./host.tsx";
export { shellRoutes } from "./routes.tsx";
export { initTheme, applyTheme, resolvedTheme } from "./theme.ts";
export { loadPrefs, savePrefs } from "./prefs.ts";
export type { WorkspaceState, PinnedState, PanelRef } from "./layout/model.ts";
export { decodeWorkspace, decodePinned } from "./layout/model.ts";
