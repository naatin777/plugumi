// icon-buttonの定型。label・押下状態・clickをまとめる。
// widget-op等の小さいボタンはclassで差し替える。
import type { JSX } from "@solidjs/web";

export function ToolButton(props: {
  label: string;
  class?: string;
  pressed?: boolean;
  onClick?: (event: MouseEvent) => void;
  onPointerDown?: (event: PointerEvent) => void;
  children: JSX.Element;
}): JSX.Element {
  return (
    <button
      class={props.class ?? "icon-button"}
      aria-label={props.label}
      aria-pressed={props.pressed === undefined
        ? undefined
        : props.pressed ? "true" : "false"}
      onClick={props.onClick}
      onPointerDown={props.onPointerDown}
    >
      {props.children}
    </button>
  );
}
