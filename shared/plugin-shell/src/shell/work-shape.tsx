// work面の形（designs/00005「work面の形」）。浮いたtitle帯のbarと
// body側のmatタイルからなる。溝の奥には床要素は敷かず、shellの背景が
// そのまま見える。
// 使う変数（親要素のinline styleやCSSで供給）:
//   --side-width … sidebarが開いていなければ0
//   --title-tools-left / --title-tools-right … tool群の実測footprint
//   --work-radius … 面の角丸
import type { JSX } from "@solidjs/web";
import { createEffect, onCleanup, type ParentProps } from "solid-js";

export interface WorkShapeProps {
  titleLeft?: JSX.Element;
  titleCenter?: JSX.Element;
  titleRight?: JSX.Element;
  sidebar?: JSX.Element;
}

export function WorkShape(props: ParentProps<WorkShapeProps>) {
  let leftInner: HTMLDivElement | undefined;
  let rightInner: HTMLDivElement | undefined;

  // tool群のmin-widthは「必要な分だけ」— 中身の自然幅を.tools-innerで
  // 測り、paddingと外側の溝を足したfootprintを--title-tools-*へ書く。
  // ResizeObserverなので内容増減・フォント適用の後追いも拾う。
  createEffect(
    () => null,
    () => {
      if (!leftInner || !rightInner) return;
      const shell = leftInner.closest("main.shell, .lab-shape");
      if (!(shell instanceof HTMLElement)) return;
      const pill = leftInner.parentElement;
      if (!pill) return;
      const cs = getComputedStyle(pill);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const gap = parseFloat(getComputedStyle(shell).getPropertyValue("--work-gap")) || 0;
      // entryの測定値をそのまま使う（callback内でoffsetWidth等を読むと
      // レイアウトflushが起き、ResizeObserver loop警告の要因になる）。
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
          const name = entry.target === leftInner
            ? "--title-tools-left"
            : "--title-tools-right";
          shell.style.setProperty(name, w === 0 ? "0px" : `${w + padX + gap}px`);
        }
      });
      ro.observe(leftInner);
      ro.observe(rightInner);
      onCleanup(() => ro.disconnect());
    },
  );

  return (
    <>
      <header class="work-title">
        <div class="title-tools left">
          <div class="tools-inner" ref={leftInner}>{props.titleLeft}</div>
        </div>
        <div class="work-segment">{props.titleCenter}</div>
        <div class="title-tools right">
          <div class="tools-inner" ref={rightInner}>{props.titleRight}</div>
        </div>
      </header>
      <div class="work-body">
        <aside class="frame-side">
          {props.sidebar}
        </aside>
        <div class="work-mat">
          {props.children}
        </div>
      </div>
    </>
  );
}
