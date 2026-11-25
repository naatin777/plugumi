// Shell同梱の組み込みPanel一覧。pluginId "shell" のlocal Pluginとして
// bundleされるものをここに並べる。中身はPluginと同じ
// `mount(host, context)` で書かれた独立package（shared/theme等）。
import * as theme from "plugumi-theme-panel";
import type { BuiltinPanelEntry } from "../host.tsx";

export const builtinPanels: BuiltinPanelEntry[] = [
  {
    kind: "builtin",
    pluginId: "shell",
    panelId: theme.panelId,
    title: theme.title,
    mount: theme.mount,
    css: theme.css,
  },
];
