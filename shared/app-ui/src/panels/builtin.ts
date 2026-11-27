// Shell同梱の組み込みPanel一覧。providerId "shell" のlocal Pluginとして
// bundleされるものをここに並べる。中身はPluginと同じ
// `mount(host, context)` で書かれた独立package（shared/theme等）。
import * as theme from "plugumi-theme-panel";
import * as files from "plugumi-files-panel";
import * as styleLab from "plugumi-style-lab-panel";
import type { BuiltinPanelEntry } from "../host.tsx";

export const builtinPanels: BuiltinPanelEntry[] = [
  {
    kind: "builtin",
    providerId: "shell",
    panelId: theme.panelId,
    title: theme.title,
    mount: theme.mount,
    css: theme.css,
  },
  {
    kind: "builtin",
    providerId: "shell",
    panelId: files.panelId,
    title: files.title,
    mount: files.mount,
    css: files.css,
  },
  {
    kind: "builtin",
    providerId: "shell",
    panelId: styleLab.panelId,
    title: styleLab.title,
    mount: styleLab.mount,
    css: styleLab.css,
  },
];
