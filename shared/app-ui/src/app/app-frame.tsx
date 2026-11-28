// Project画面の外枠。main.appに既知の幅をCSS変数として供給し、
// work面の形はCSSだけで決まる。
// （Area list＋Sub）をまとめて畳む。キーはe.codeで見る（⌥⌘1-2, ⌥⌘Z）。
// main.appの幅はResizeObserverで測りappSizeへ — 狭いときはSubと
// Area listがdrawerになる（app-frame.css・app-shape.cssのdata-size規則）。
import { Show, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useApp, createAreaController } from "./controller.tsx";
import { findLeaf, selectPanel } from "../layout/model.ts";
import { flipPage } from "./pages.tsx";
import { AppShape } from "./app-shape.tsx";
import { StatusBar } from "./status-bar.tsx";
import { TitleToolsLeft, TitleSegmentMain, TitleToolsRight } from "./title-tools.tsx";
import { SidebarView } from "./sidebar.tsx";
import { AreaView, AreaEmpty, DragGhost } from "./area-view.tsx";
import { Resizer } from "./resizer.tsx";
import { resolveBackgroundImage } from "plugumi-theme-panel";
import "./app-frame.css";
import "./area-view.css";

// prefの既定値は同梱フォント自身なので、fallback連結の前に重複を除く。
// 空白を含むfamily名はquoteしておき、generic familyはCSSのkeywordのままにする。
const fontStack = (preferred: string, bundled: string, rest: string[]): string => {
  const seen = new Set<string>();
  return [preferred, bundled, ...rest]
    .map((family) => family.trim().replace(/^["']|["']$/g, ""))
    .filter((family) => {
      const key = family.toLowerCase();
      if (!family || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((family) => /^[a-zA-Z-]+$/.test(family) ? family : `"${family}"`)
    .join(", ");
};

export function AppFrame(): JSX.Element {
  const app = useApp();
  const prefs = () => app.prefs();
  // work面の形に使う幅。drawer化している列はgridから外すので0を渡す。
  const sideWidth = () => (
    app.sideDrawerMode() || !app.sideShown() ? 0 : prefs().sidebarWidth
  );
  const subInline = () => !app.subDrawerMode() && app.subShown();

  // Main/SubのAreaController。MainはURLが指すArea、SubはArea listの選択。
  const mainArea = createAreaController(app, () => app.mainRef());
  const subArea = createAreaController(app, () => app.subRef());

  const keydown = (event: KeyboardEvent) => {
    if (event.code === "Escape") {
      // 開いている一時drawerを全部畳む。
      app.closeDrawers();
      return;
    }
    if (!event.metaKey && !event.ctrlKey) return;
    if (!event.altKey) return;
    if (event.code === "BracketLeft" || event.code === "BracketRight") {
      // 触っている側のArea（無ければMain）のfocused leafのpageを前後へ
      const area = app.focusedArea() ?? mainArea;
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
    const which = event.code === "Digit1" ? "sidebar"
      : event.code === "Digit2" ? "sub" : null;
    if (!which) return;
    if (which === "sidebar") app.toggleSide();
    else app.toggleSub();
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
    app.closeDrawers();
  };
  document.addEventListener("pointerdown", outsideDown, true);
  onCleanup(() => document.removeEventListener("pointerdown", outsideDown, true));

  // shellの幅はResizeObserverで測りappSizeへ（<1100でSub、<800で
  // Area listがdrawer）。callback内でoffsetWidth等は読まない。
  let ro: ResizeObserver | undefined;
  onCleanup(() => ro?.disconnect());
  const measure = (w: number) =>
    app.setAppSize(w >= 1100 ? "wide" : w >= 800 ? "medium" : "compact");
  const observe = (node: HTMLElement) => {
    // 初回はpaint前に同期的に測る — 既定値"wide"のままpaintされると
    // 狭い窓でinlineの列が一瞬見えてからdrawerへ飛ぶ（reload時のflash）。
    measure(node.offsetWidth);
    ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        measure(entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width);
      }
    });
    ro.observe(node);
  };

  return (
    <main
      ref={observe}
      class={{ ["app"]: true }}
      data-part="app"
      // Layer 0の床の種類。imageが選ばれていても画像が無ければnoneに
      // 落とす（画像を消したあとprefだけ残る経路がある）。
      data-bg={
        prefs().background === "image" && !prefs().backgroundImage
          ? "none"
          : prefs().background
      }
      // bodyの列は開いている側だけ（data-attrでCSSが組み替える）。
      data-size={app.appSize()}
      data-side={sideWidth() > 0 ? "" : undefined}
      data-sub={subInline() ? "" : undefined}
      style={{
        "--side-width": `${sideWidth()}px`,
        "--sidebar-raw-width": `${prefs().sidebarWidth}px`,
        // --sub-widthはinlineのSub列がlayoutに占める幅（閉・drawer時は0）。
        // 開閉はこの変数の補間で滑らせ、pane自体の幅は変えない。
        // --sub-raw-widthはdrawerの幅の計算に使う設定値。
        "--sub-width": `${subInline() ? prefs().subWidth : 0}px`,
        "--sub-raw-width": `${prefs().subWidth}px`,
        // テーマPanelのスライダーが動かす表示設定。
        "--aurora-vivid": prefs().auroraVivid / 100,
        "--app-frame-alpha": prefs().frameAlpha / 100,
        // 膜（Layer 1）のblur量。床の要素にかかる。
        "--membrane-blur": `${prefs().membraneBlur}px`,
        // 床の画像。preset参照は解決してURLにする。data URLなので
        // 引用符を含まずCSS varに載せられる。
        "--app-bg-image":
          prefs().background === "image" && prefs().backgroundImage
            ? `url(${resolveBackgroundImage(prefs().backgroundImage)})`
            : "none",
        // sans/monoとも「pref → 同梱のPlex → localのPlex Sans JP
        // → system」の順で解決する。prefに無いfamily名を書かれても
        // 同梱フォントへ戻るのでappの顔は保てる。
        "--plugumi-font-family-sans": fontStack(
          prefs().sansFont, "IBM Plex Sans",
          ["IBM Plex Sans JP", "ui-sans-serif", "system-ui", "sans-serif"],
        ),
        "--plugumi-font-family-mono": fontStack(
          prefs().monoFont, "IBM Plex Mono",
          ["IBM Plex Sans JP", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        ),
      }}
    >
      {/* 列の境界線（Area list|Main / Main|Sub）。表示はdata-side/
          data-subで切り替える。 */}
      <div class={"col-divider"} data-part="col-divider" data-divider="side" />
      <div class={"col-divider"} data-part="col-divider" data-divider="sub" />
      <AppShape
        titleLeft={<TitleToolsLeft />}
        titleMain={<TitleSegmentMain area={mainArea} />}
        titleRight={<TitleToolsRight />}
        sidebar={
          // 常時mount — 閉じるときも中身ごとslideして出るのはsub-paneと
          // 同じ構造。閉じた後のfocus隔離はdata-closedのvisibilityが担う。
          <SidebarView />
        }
        sidebarDrawer={app.sideDrawerMode()}
        sidebarClosed={!app.sideShown()}
        scrimOpen={
          (app.subDrawerMode() && app.subShown()) ||
          (app.sideDrawerMode() && app.sideShown())
        }
      >
        <Show when={app.mainRef()} fallback={<AreaEmpty />}>
          <AreaView area={mainArea} />
        </Show>
        <Show when={subInline() || app.subDrawerMode()}>
          <Resizer
            axis="x"
            direction={-1}
            drawerKeep={app.subDrawerMode()}
            value={() => prefs().subWidth}
            apply={(size) => {
              // drawerでも同じsubWidthを共有する。上限はdrawerの上限
              // （mat幅の90%）でclampし、越えた値は保存しない。
              const max = app.subDrawerMode()
                ? 0.9 * (document.querySelector('[data-part="main-slot"]')?.clientWidth ?? innerWidth)
                : 960;
              const clamped = Math.min(max, Math.max(240, size));
              app.updatePrefs((prefs) => { prefs.subWidth = clamped; });
            }}
          />
        </Show>
        <div
          class={"sub-pane"}
          data-part="sub-slot"
          data-closed={!app.subShown() || undefined}
          // drawerのSubの中へのclickは「外」にしない。
          data-drawer-keep={app.subDrawerMode() ? "" : undefined}
        >
          <Show
            when={app.subRef()}
            fallback={<p class={"area-view-empty"}>Subに表示するAreaを選んでください</p>}
          >
            <AreaView area={subArea} />
          </Show>
        </div>
      </AppShape>
      <StatusBar />
      <DragGhost />
    </main>
  );
}
