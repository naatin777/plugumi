// Project画面の外枠。main.shellに既知の幅をCSS変数として供給し、
// work面の形はCSSだけで決まる。sideHiddenは個別の開閉を潰さず左右の
// frame領域をまとめて畳む。キーはe.codeで見る（⌥⌘1-5, ⌥⌘Z）。
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
  const sideHidden = () => prefs().sideHidden;
  // work面の形に使う幅。sideHiddenでは0を渡す（開閉状態自体は潰さない）。
  const sideWidth = () => (sideHidden() || !prefs().sidebarOpen ? 0 : prefs().sidebarWidth);
  const pinnedWidth = () => (sideHidden() || !prefs().pinnedOpen ? 0 : prefs().pinnedWidth);
  // dockの開閉はdata-closedで幅0に畳む（unmountしない — Panel状態を保つ上に
  // 畳み込みアニメが効く）。
  const dockShown = (kind: "left" | "bottom" | "right") => prefs().dockOpen[kind];

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
      shell.updatePrefs((prefs) => { prefs.sideHidden = !prefs.sideHidden; });
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
      class={{ shell: true, "no-aurora": !prefs().aurora }}
      // bodyの列は開いている側だけ（data-attrでCSSが組み替える）。
      data-side={sideWidth() > 0 ? "" : undefined}
      data-pinned={pinnedWidth() > 0 ? "" : undefined}
      style={{
        "--side-width": `${sideWidth()}px`,
        "--pinned-width": `${pinnedWidth()}px`,
      }}
    >
      <WorkShape
        titleLeft={<TitleToolsLeft />}
        titleCenter={<TitleToolsCenter />}
        titleRight={<TitleToolsRight />}
        sidebar={<Show when={prefs().sidebarOpen && !sideHidden()}><SidebarView /></Show>}
        pinned={<Show when={prefs().pinnedOpen && !sideHidden()}><PinnedBoard /></Show>}
      >
        <Dock kind="left" closed={!dockShown("left")} />
        <CenterView />
        <Dock kind="right" closed={!dockShown("right")} />
        <Dock kind="bottom" closed={!dockShown("bottom")} />
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
