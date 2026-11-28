// テーマ切替Panel。providerId "shell" のlocal Pluginとしてplugin-shellの
// bundleに同梱される（Core経由のUI Bundleではない）。Pluginと同じ
// `mount(host, context)` の形で書き、CSSはテキストとして渡して
// ShadowRootへadoptさせる。
import styles from "./theme.css?inline";

export const panelId = "theme";
export const title = "テーマ";
export { mount } from "./theme.tsx";
export const css = styles;
export { backgroundPresets, resolveBackgroundImage } from "./presets.ts";
