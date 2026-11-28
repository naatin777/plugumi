// work面の形（designs/00005「work面の形」）。平らなtitle帯（tool群と
// 開閉区画の見えない区画）と、body側の列（Area list・work mat）からなる。
// 溝の奥には床要素は敷かず、shellの背景がそのまま見える。
// 使う変数（親要素のinline styleやCSSで供給）:
//   --side-width … sidebarが開いていなければ0
//   --title-tools-left / --title-tools-right … tool群の実測footprint
import type { JSX } from "@solidjs/web";
import { createEffect, onCleanup, type ParentProps } from "solid-js";
import "./app-shape.css";

export interface AppShapeProps {
  titleLeft?: JSX.Element;
  // Main列の真上に置く区画。Sub列の上にはsegmentを置かない。
  titleMain?: JSX.Element;
  titleRight?: JSX.Element;
  sidebar?: JSX.Element;
  // 幅が足りないときsidebar列はdrawerになる（main.app[data-size]で切替）。
  // drawerのときは列自体は畳み、閉じると画面外へ逃がす。
  sidebarDrawer?: boolean;
  sidebarClosed?: boolean;
  // SubまたはArea listのdrawerが開いているか（app-scrimの表示）。
  scrimOpen?: boolean;
}

export function AppShape(props: ParentProps<AppShapeProps>) {
  let leftInner: HTMLDivElement | undefined;
  let rightInner: HTMLDivElement | undefined;

  // tool群のmin-widthは「必要な分だけ」— 中身の自然幅を.tools-innerで
  // 測り、paddingと外側の溝を足したfootprintを--title-tools-*へ書く。
  // ResizeObserverなので内容増減・フォント適用の後追いも拾う。
  let ro: ResizeObserver | undefined;
  onCleanup(() => ro?.disconnect());
  createEffect(
    () => null,
    () => {
      if (!leftInner || !rightInner) return;
      const host = leftInner.closest('[data-part="app"]');
      if (!(host instanceof HTMLElement)) return;
      const pill = leftInner.parentElement;
      if (!pill) return;
      const cs = getComputedStyle(pill);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const gap = parseFloat(getComputedStyle(host).getPropertyValue("--app-gap")) || 0;
      // entryの測定値をそのまま使う（callback内でoffsetWidth等を読むと
      // レイアウトflushが起き、ResizeObserver loop警告の要因になる）。
      ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
          const name = entry.target === leftInner
            ? "--title-tools-left"
            : "--title-tools-right";
          host.style.setProperty(name, w === 0 ? "0px" : `${w + padX + gap}px`);
        }
      });
      ro.observe(leftInner);
      ro.observe(rightInner);
    },
  );

  return (
    <>
      <header class={"titlebar"} data-part="titlebar">
        <div class="title-tools" data-edge="left">
          <div class={"tools-inner"} ref={leftInner}>{props.titleLeft}</div>
        </div>
        <div class={"titlebar-segment"} data-slot="main">{props.titleMain}</div>
        <div class="title-tools" data-edge="right">
          <div class={"tools-inner"} ref={rightInner}>{props.titleRight}</div>
        </div>
      </header>
      <div class={"app-body"}>
        {/* Sub・Area listのdrawerが開いている間、台のすぐ下・作業域全体に
            敷く薄い暗幕（app bar・status barは暗くしない）。col-dividerは
            DOM順でこの下になるので線は一緒に暗くなる。pointerは通す。 */}
        <div class={"app-scrim"} data-part="app-scrim" data-closed={props.scrimOpen ? undefined : ""} />
        <aside
          class={"area-list"}
          data-part="area-list"
          data-drawer={props.sidebarDrawer ? "" : undefined}
          data-closed={props.sidebarClosed ? "" : undefined}
          // drawerの外click判定で「内側」扱いにする（drawerのときだけ —
          // inlineの列は「外」であってよい）。
          data-drawer-keep={props.sidebarDrawer ? "" : undefined}
        >
          {props.sidebar}
        </aside>
        <div class={"mat"} data-part="main-slot">
          {props.children}
        </div>
      </div>
    </>
  );
}
