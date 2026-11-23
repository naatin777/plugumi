// work面の形（designs/00005「work面の形」）。浮いたtitle帯のbarと、
// body側のmatタイル、その内側の床（溝の奥の面）からなる。
// 使う変数（親要素のinline styleやCSSで供給）:
//   --side-width / --pinned-width … 開いていなければ0
//   --title-tools-left / --title-tools-right … 左右のtool群の固定設計幅
//   --work-radius … 面の角丸
import type { JSX } from "@solidjs/web";
import type { ParentProps } from "solid-js";

export interface WorkShapeProps {
  titleLeft?: JSX.Element;
  titleCenter?: JSX.Element;
  titleRight?: JSX.Element;
  sidebar?: JSX.Element;
  pinned?: JSX.Element;
}

export function WorkShape(props: ParentProps<WorkShapeProps>) {
  return (
    <>
      <header class="work-title">
        <div class="title-tools left">{props.titleLeft}</div>
        <div class="work-segment">{props.titleCenter}</div>
        <div class="title-tools right">{props.titleRight}</div>
      </header>
      <div class="work-body">
        <aside class="frame-side">
          {props.sidebar}
        </aside>
        <div class="work-mat">
          <div class="work-bed" aria-hidden="true" />
          {props.children}
        </div>
        <aside class="frame-pinned">
          {props.pinned}
        </aside>
      </div>
    </>
  );
}
