// icon-buttonの定型。label・押下状態・clickをまとめる。
// widget-op等の小さいボタンはclassで差し替える。
import type { JSX } from "@solidjs/web";
import controlStyles from "./controls.module.css";

export function ToolButton(props: {
  label: string;
  class?: string;
  pressed?: boolean;
  // drawerを開くボタンは外click判定の「内側」にする。
  keep?: boolean;
  onClick?: (event: MouseEvent) => void;
  onPointerDown?: (event: PointerEvent) => void;
  children: JSX.Element;
}): JSX.Element {
  return (
    <button
      class={props.class ?? controlStyles["icon-button"]}
      aria-label={props.label}
      aria-pressed={props.pressed === undefined
        ? undefined
        : props.pressed ? "true" : "false"}
      onClick={props.onClick}
      onPointerDown={props.onPointerDown}
      data-drawer-keep={props.keep ? "" : undefined}
    >
      {props.children}
    </button>
  );
}
