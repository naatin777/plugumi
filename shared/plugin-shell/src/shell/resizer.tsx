// 溝のresizer。pointerを掴んで、開始値+変位（direction込み）を
// applyへ渡す。clampや保存は呼び側が行う。
import type { JSX } from "@solidjs/web";

export interface ResizerProps {
  axis: "x" | "y";
  // ポインタを進めた向きに値が増えるなら1、逆向きなら-1。
  direction: 1 | -1;
  value: () => number;
  apply: (size: number) => void;
  // 値1単位あたりのpx。ratioのような比のresizeに使う。
  scale?: () => number;
}

export function Resizer(props: ResizerProps): JSX.Element {
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const el = event.currentTarget as HTMLElement;
    el.dataset.dragging = "";
    const origin = props.axis === "x" ? event.clientX : event.clientY;
    const start = props.value();
    const move = (next: PointerEvent) => {
      const position = props.axis === "x" ? next.clientX : next.clientY;
      const delta = (position - origin) / (props.scale?.() ?? 1);
      props.apply(start + props.direction * delta);
    };
    const up = (done: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      delete el.dataset.dragging;
      move(done);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    event.preventDefault();
  };
  return (
    <div class="resizer" data-axis={props.axis} onPointerDown={down} aria-hidden="true" />
  );
}
