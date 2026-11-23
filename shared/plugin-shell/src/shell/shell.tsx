// Project画面の外枠。main.shellに既知の幅をCSS変数として供給し、
// work面の形はCSSだけで決まる。zenは個別の開閉を潰さずframeをまとめて
// 引っ込める。キーはe.codeで見る（⌥⌘1-5, ⌥⌘Z）。
import { Show, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useShell } from "./controller.tsx";
import { findLeaf, selectPanel } from "../layout/model.ts";
import { WorkShape } from "./work-shape.tsx";
import { StatusBar } from "./status-bar.tsx";
import { TitleToolsLeft, TitleToolsCenter, TitleToolsRight } from "./title-tools.tsx";
import { SidebarView } from "./sidebar.tsx";
import { Dock } from "./dock.tsx";
import { CenterView } from "./center.tsx";

export function ShellFrame(): JSX.Element {
  const shell = useShell();
  const prefs = () => shell.prefs();
  const zen = () => prefs().frameHidden;
  // work面の形に使う幅。zenでは0を渡す（開閉状態自体は潰さない）。
  const sideWidth = () => (zen() || !prefs().sidebarOpen ? 0 : prefs().sidebarWidth);
  const pinnedWidth = () => (zen() || !prefs().pinnedOpen ? 0 : prefs().pinnedWidth);

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
      if (leaf && leaf.panels.length > 1) {
        const index = leaf.panels.findIndex((ref) => ref.instanceId === leaf.selected);
        const step = event.code === "BracketRight" ? 1 : -1;
        const next = leaf.panels[Math.min(leaf.panels.length - 1, Math.max(0, index + step))];
        if (next) {
          shell.applyLayout((state) => selectPanel(state, next.instanceId));
          event.preventDefault();
        }
      }
      return;
    }
    if (event.code === "KeyZ") {
      shell.updatePrefs((prefs) => { prefs.frameHidden = !prefs.frameHidden; });
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
      class={{ shell: true, "frame-hidden": zen() }}
      style={{
        "--side-width": `${sideWidth()}px`,
        "--pinned-width": `${pinnedWidth()}px`,
      }}
    >
      <WorkShape
        titleLeft={<TitleToolsLeft />}
        titleCenter={<TitleToolsCenter />}
        titleRight={<TitleToolsRight />}
        sidebar={<Show when={prefs().sidebarOpen && !zen()}><SidebarView /></Show>}
        pinned={<Show when={prefs().pinnedOpen && !zen()}><Dock kind="pinned" /></Show>}
      >
        <Show when={prefs().dockOpen.left}><Dock kind="left" /></Show>
        <CenterView />
        <Show when={prefs().dockOpen.right}><Dock kind="right" /></Show>
        <Show when={prefs().dockOpen.bottom}><Dock kind="bottom" /></Show>
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
