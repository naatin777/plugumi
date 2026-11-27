// Style Lab — design systemの公開カタログ。tokenとcomponentを
// 実際のmount環境（ShadowRoot + adoptedStyleSheets + token継承）で
// 描くので、plugin作者が見るものと同じ見え方になる。
// components.cssはpluginと同じく自分でadoptする — lab自身が
// 「componentを使うplugin」の犬糧でもある。
import components from "@plugumi/view/components.css?inline";
import styles from "./lab.css?inline";

export const panelId = "style-lab";
export const title = "Style Lab";
export { mount } from "./lab.tsx";
export const css = `${components}\n${styles}`;
