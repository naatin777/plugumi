// Project画面の外枠。main.shellに既知の幅をCSS変数として供給し、
// work面の形はCSSだけで決まる。
// （Area list＋Sub）をまとめて畳む。キーはe.codeで見る（⌥⌘1-5, ⌥⌘Z）。
// main.shellの幅はResizeObserverで測りshellSizeへ — 狭いときはSubと
// Area listがdrawerになる（shell.cssのdata-size規則）。
import { Show, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useShell, createAreaController } from "./controller.tsx";
import { findLeaf, selectPanel } from "../layout/model.ts";
import { flipPage } from "./pages.tsx";
import { WorkShape } from "./work-shape.tsx";
import { StatusBar } from "./status-bar.tsx";
import { TitleToolsLeft, TitleSegmentMain, TitleSegmentSub, TitleToolsRight } from "./title-tools.tsx";
import { SidebarView } from "./sidebar.tsx";
import { AreaView, AreaEmpty, DragGhost } from "./area-view.tsx";
import { Resizer } from "./resizer.tsx";

export function ShellFrame(): JSX.Element {
  const shell = useShell();
  const prefs = () => shell.prefs();
  // work面の形に使う幅。drawer化している列はgridから外すので0を渡す。
  const sideWidth = () => (
    shell.sideDrawerMode() || !shell.sideShown() ? 0 : prefs().sidebarWidth
  );
  const subInline = () => !shell.subDrawerMode() && shell.subShown();

  // Main/SubのAreaController。MainはURLが指すArea、SubはArea listの選択。
  const mainArea = createAreaController(shell, () => shell.mainRef());
  const subArea = createAreaController(shell, () => shell.subRef());

  const keydown = (event: KeyboardEvent) => {
    if (event.code === "Escape") {
      // 開いている一時drawerを全部畳む。
      shell.closeDrawers();
      mainArea.setDrawer(null);
      subArea.setDrawer(null);
      return;
    }
    if (!event.metaKey && !event.ctrlKey) return;
    if (!event.altKey) return;
    if (event.code === "BracketLeft" || event.code === "BracketRight") {
      // 触っている側のArea（無ければMain）のfocused leafのpageを前後へ
      const area = shell.focusedArea() ?? mainArea;
      const center = area.layout().center;
      const leaf = findLeaf(center.root, center.focusedLeaf);
      const next = leaf && flipPage(
        leaf.panels, leaf.selected, event.code === "BracketRight" ? 1 : -1,
      );
      if (next) {
        area.applyLayout((state) => selectPanel(state, next));
        event.preventDefault();
      }
      return;
    }
    const toggle = () => {
      switch (event.code) {
        case "Digit1": return "sidebar" as const;
        case "Digit2": return "left" as const;
        case "Digit3": return "bottom" as const;
        case "Digit4": return "right" as const;
        case "Digit5": return "sub" as const;
        default: return null;
      }
    };
    const which = toggle();
    if (!which) return;
    if (which === "sidebar") shell.toggleSide();
    else if (which === "sub") shell.toggleSub();
    else mainArea.toggleDock(which);
    event.preventDefault();
  };

  // キーはwindowで拾う（focusがPanel内にあっても届くように）。
  // ref callbackはunownedなので、登録と解除はcomponent bodyで行う。
  window.addEventListener("keydown", keydown);
  onCleanup(() => window.removeEventListener("keydown", keydown));

  // drawerの外をpointerdownしたら全部畳む。開いているdrawer自身と
  // drawerを切り替えるボタンは[data-drawer-keep]で「内側」扱い。
  const outsideDown = (event: PointerEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-drawer-keep]")) return;
    shell.closeDrawers();
    mainArea.setDrawer(null);
    subArea.setDrawer(null);
  };
  document.addEventListener("pointerdown", outsideDown, true);
  onCleanup(() => document.removeEventListener("pointerdown", outsideDown, true));

  // shellの幅はResizeObserverで測りshellSizeへ（<1100でSub、<800で
  // Area listがdrawer）。callback内でoffsetWidth等は読まない。
  let ro: ResizeObserver | undefined;
  onCleanup(() => ro?.disconnect());
  const observe = (node: HTMLElement) => {
    ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        shell.setShellSize(w >= 1100 ? "wide" : w >= 800 ? "medium" : "compact");
      }
    });
    ro.observe(node);
  };

  return (
    <main
      ref={observe}
      class={{ shell: true, "no-aurora": !prefs().aurora }}
      // bodyの列は開いている側だけ（data-attrでCSSが組み替える）。
      data-size={shell.shellSize()}
      data-side={sideWidth() > 0 ? "" : undefined}
      data-sub={subInline() ? "" : undefined}
      style={{
        "--side-width": `${sideWidth()}px`,
        "--sidebar-raw-width": `${prefs().sidebarWidth}px`,
        // --sub-widthはinlineのSub列の幅（閉・drawer時は0）。
        // --sub-raw-widthはdrawerの幅の計算に使う設定値。
        "--sub-width": `${subInline() ? prefs().subWidth : 0}px`,
        "--sub-raw-width": `${prefs().subWidth}px`,
      }}
    >
      {/* 列の境界線（Area list|Main / Main|Sub）。表示はdata-side/
          data-subで切り替える。 */}
      <div class="col-divider" data-divider="side" />
      <div class="col-divider" data-divider="sub" />
      <WorkShape
        titleLeft={<TitleToolsLeft />}
        titleMain={<TitleSegmentMain area={mainArea} />}
        titleSub={<TitleSegmentSub area={subArea} />}
        titleRight={<TitleToolsRight />}
        sidebar={
          <Show when={shell.sideDrawerMode() || prefs().sidebarOpen}>
            <SidebarView />
          </Show>
        }
        sidebarDrawer={shell.sideDrawerMode()}
        sidebarClosed={!shell.sideShown()}
        scrimOpen={
          (shell.subDrawerMode() && shell.subShown()) ||
          (shell.sideDrawerMode() && shell.sideShown())
        }
      >
        <Show when={shell.mainRef()} fallback={<AreaEmpty />}>
          <AreaView area={mainArea} slot="main" />
        </Show>
        <Show when={subInline() || shell.subDrawerMode()}>
          <Resizer
            axis="x"
            direction={-1}
            drawerKeep={shell.subDrawerMode()}
            value={() => prefs().subWidth}
            apply={(size) => {
              // drawerでも同じsubWidthを共有する。上限はdrawerの上限
              // （work-mat幅の90%）でclampし、越えた値は保存しない。
              const max = shell.subDrawerMode()
                ? 0.9 * (document.querySelector(".work-mat")?.clientWidth ?? innerWidth)
                : 960;
              const clamped = Math.min(max, Math.max(240, size));
              shell.updatePrefs((prefs) => { prefs.subWidth = clamped; });
            }}
          />
        </Show>
        <div
          class="sub-pane"
          data-closed={!shell.subShown() || undefined}
          // drawerのSubの中へのclickは「外」にしない。
          data-drawer-keep={shell.subDrawerMode() ? "" : undefined}
        >
          <Show
            when={shell.subRef()}
            fallback={<p class="area-view-empty">Subに表示するAreaを選んでください</p>}
          >
            <AreaView area={subArea} slot="sub" />
          </Show>
        </div>
      </WorkShape>
      <StatusBar />
      <DragGhost />
    </main>
  );
}
