// work面の形（designs/00005「work面の形」）。title区間・body側のmat・
// 凹凸の角片からなる1つの図形。形は既知のCSS変数だけで決まり、
// 描画後の要素を測ることはしない。
// 使う変数（親要素のinline styleやCSSで供給）:
//   --side-width / --pinned-width … 開いていなければ0
//   --title-tools-left / --title-tools-right … 左右のtool群の固定設計幅
//   --work-radius … work面の角丸
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
        <div class="work-corner left" aria-hidden="true" />
        <div class="work-corner right" aria-hidden="true" />
      </header>
      <div class="work-body">
        <aside class="frame-side">
          <div class="work-corner under under-left" aria-hidden="true" />
          {props.sidebar}
        </aside>
        <div class="work-mat">
          <div class="work-center-mat" aria-hidden="true" />
          {props.children}
        </div>
        <aside class="frame-pinned">
          <div class="work-corner under under-right" aria-hidden="true" />
          {props.pinned}
        </aside>
      </div>
    </>
  );
}
