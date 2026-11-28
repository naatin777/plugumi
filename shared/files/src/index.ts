// file explorer Panel。providerId "app" のlocal Pluginとしてworkbenchの
// bundleに同梱される（Core経由のUI Bundleではない）。
// Environment ProviderはheadlessなのでUIを持たず、このPanelが
// fs/listを宣言した登録を見つけてcapabilityを呼ぶ。
import components from "@plugumi/view/components.css?inline";
import styles from "./files.css?inline";

export const panelId = "files";
export const title = "Files";
export { mount } from "./files.tsx";
export const css = `${components}\n${styles}`;
