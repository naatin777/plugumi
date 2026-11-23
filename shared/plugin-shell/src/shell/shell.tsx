// Project画面の外枠。main.shellに既知の幅をCSS変数として供給し、
// work面の形はCSSだけで決まる。focusは個別の開閉を潰さずframeをまとめて
// 引っ込める。キーはe.codeで見る（⌥⌘1-5, ⌥⌘Z）。
import { Show, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useShell } from "./controller.tsx";
import { findLeaf, selectPanel } from "../layout/model.ts";
import { flipPage } from "./pages.tsx";
import { WorkShape } from "./work-shape.tsx";
import { StatusBar } from "./status-bar.tsx";
import { TitleToolsLeft, TitleToolsCenter, TitleToolsRight } from "./title-tools.tsx";
import { SidebarView } from "./sidebar.tsx";
import { Dock } from "./dock.tsx";
import { PinnedBoard } from "./pinned.tsx";
import { CenterView } from "./center.tsx";

export function ShellFrame(): JSX.Element {
  const shell = useShell();
  const prefs = () => shell.prefs();
  const focus = () => prefs().focusMode;
  // work面の形に使う幅。focusでは0を渡す（開閉状態自体は潰さない）。
  const sideWidth = () => (focus() || !prefs().sidebarOpen ? 0 : prefs().sidebarWidth);
  const pinnedWidth = () => (focus() || !prefs().pinnedOpen ? 0 : prefs().pinnedWidth);
  // dockもfocusでは引っ込める — 開閉状態は潰さず表示だけ0にする。
  const dockShown = (kind: "left" | "bottom" | "right") =>
    !focus() && prefs().dockOpen[kind];
  // matのgrid template。閉じたdockの分は列/行ごと消す — 0幅のauto列を
  // 残すと列間のgapだけが溝として残って空きレーンになるため。
  // bodyの列も開いている側だけ（aside自体はdata-attrで消す）。
  const bodyCols = () => {
    const cols: string[] = [];
    if (sideWidth() > 0) cols.push("var(--side-width)");
    cols.push("minmax(0, 1fr)");
    if (pinnedWidth() > 0) cols.push("var(--pinned-width)");
    return cols.join(" ");
  };
  const matTemplate = () => {
    const open = { left: dockShown("left"), right: dockShown("right"), bottom: dockShown("bottom") };
    const areas: string[] = [];
    const sizes: string[] = [];
    if (open.left) { areas.push("left"); sizes.push("auto"); }
    areas.push("center"); sizes.push("minmax(0, 1fr)");
    if (open.right) { areas.push("right"); sizes.push("auto"); }
    const rows = [`"${areas.join(" ")}" minmax(0, 1fr)`];
    if (open.bottom) rows.push(`"${" bottom".repeat(areas.length).trimStart()}" auto`);
    return `${rows.join(" ")} / ${sizes.join(" ")}`;
  };

  const keydown = (event: KeyboardEvent) => {
    if (!event.metaKey && !event.ctrlKey) return;
    if (!event.altKey) return;
    const dockOf: Record<string, "sidebar" | "left" | "bottom" | "right" | "pinned"> = {
      Digit1: "sidebar", Digit2: "left", Digit3: "bottom", Digit4: "right", Digit5: "pinned",
    };
    if (event.code === "BracketLeft" || event.code === "BracketRight") {
      // focused leafのpageを前後へ（pagesの切替え）
      const center = shell.layout().workspace.center;
      const leaf = findLeaf(center.root, center.focusedLeaf);
      const next = leaf && flipPage(
        leaf.panels, leaf.selected, event.code === "BracketRight" ? 1 : -1,
      );
      if (next) {
        shell.applyLayout((state) => selectPanel(state, next));
        event.preventDefault();
      }
      return;
    }
    if (event.code === "KeyZ") {
      shell.updatePrefs((prefs) => { prefs.focusMode = !prefs.focusMode; });
      event.preventDefault();
      return;
    }
    const which = dockOf[event.code];
    if (!which) return;
    shell.updatePrefs((prefs) => {
      if (which === "sidebar") prefs.sidebarOpen = !prefs.sidebarOpen;
      else if (which === "pinned") prefs.pinnedOpen = !prefs.pinnedOpen;
      else prefs.dockOpen = { ...prefs.dockOpen, [which]: !prefs.dockOpen[which] };
    });
    event.preventDefault();
  };

  // キーはwindowで拾う（focusがPanel内にあっても届くように）。
  // ref callbackはunownedなので、登録と解除はcomponent bodyで行う。
  window.addEventListener("keydown", keydown);
  onCleanup(() => window.removeEventListener("keydown", keydown));

  return (
    <main
      class={{ shell: true, "focus": focus(), "no-aurora": !prefs().aurora }}
      // bodyの列は開いている側だけ（data-attrでCSSが組み替える）。
      data-side={sideWidth() > 0 ? "" : undefined}
      data-pinned={pinnedWidth() > 0 ? "" : undefined}
      style={{
        "--side-width": `${sideWidth()}px`,
        "--pinned-width": `${pinnedWidth()}px`,
        "--body-cols": bodyCols(),
        "--mat-template": matTemplate(),
      }}
    >
      <WorkShape
        titleLeft={<TitleToolsLeft />}
        titleCenter={<TitleToolsCenter />}
        titleRight={<TitleToolsRight />}
        sidebar={<Show when={prefs().sidebarOpen && !focus()}><SidebarView /></Show>}
        pinned={<Show when={prefs().pinnedOpen && !focus()}><PinnedBoard /></Show>}
      >
        <Show when={dockShown("left")}><Dock kind="left" /></Show>
        <CenterView />
        <Show when={dockShown("right")}><Dock kind="right" /></Show>
        <Show when={dockShown("bottom")}><Dock kind="bottom" /></Show>
      </WorkShape>
      <StatusBar />
      <DragGhost />
    </main>
  );
}

function DragGhost(): JSX.Element {
  const shell = useShell();
  return (
    <Show when={shell.ghost()}>
      {(ghost) => (
        <div class="drag-ghost" style={{ left: `${ghost().x + 8}px`, top: `${ghost().y + 8}px` }}>
          {ghost().title}
        </div>
      )}
    </Show>
  );
}
