// Project画面の外枠。main.shellに既知の幅をCSS変数として供給し、
// work面の形はCSSだけで決まる。sideHiddenは個別の開閉を潰さず両端の列
// （Area list＋Sub）をまとめて畳む。キーはe.codeで見る（⌥⌘1-5, ⌥⌘Z）。
import { Show, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useShell, createAreaController } from "./controller.tsx";
import { findLeaf, selectPanel } from "../layout/model.ts";
import { flipPage } from "./pages.tsx";
import { WorkShape } from "./work-shape.tsx";
import { StatusBar } from "./status-bar.tsx";
import { TitleToolsLeft, TitleToolsCenter, TitleToolsRight } from "./title-tools.tsx";
import { SidebarView } from "./sidebar.tsx";
import { AreaView, AreaEmpty, DragGhost } from "./area-view.tsx";
import { Resizer } from "./resizer.tsx";

export function ShellFrame(): JSX.Element {
  const shell = useShell();
  const prefs = () => shell.prefs();
  const sideHidden = () => prefs().sideHidden;
  // work面の形に使う幅。sideHiddenでは0を渡す（開閉状態自体は潰さない）。
  const sideWidth = () => (sideHidden() || !prefs().sidebarOpen ? 0 : prefs().sidebarWidth);
  const subShown = () => prefs().subOpen && !sideHidden();

  // Main/SubのAreaController。MainはURLが指すArea、SubはArea listの選択。
  const mainArea = createAreaController(shell, () => shell.mainRef());
  const subArea = createAreaController(shell, () => shell.subRef());

  const keydown = (event: KeyboardEvent) => {
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
    if (event.code === "KeyZ") {
      shell.updatePrefs((prefs) => { prefs.sideHidden = !prefs.sideHidden; });
      event.preventDefault();
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
    shell.updatePrefs((prefs) => {
      if (which === "sidebar") prefs.sidebarOpen = !prefs.sidebarOpen;
      else if (which === "sub") prefs.subOpen = !prefs.subOpen;
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
      data-sub={subShown() ? "" : undefined}
      style={{
        "--side-width": `${sideWidth()}px`,
        "--sub-width": `${subShown() ? prefs().subWidth : 0}px`,
      }}
    >
      <WorkShape
        titleLeft={<TitleToolsLeft />}
        titleCenter={<TitleToolsCenter area={mainArea} />}
        titleRight={<TitleToolsRight />}
        sidebar={<Show when={prefs().sidebarOpen && !sideHidden()}><SidebarView /></Show>}
      >
        <Show when={shell.mainRef()} fallback={<AreaEmpty />}>
          <AreaView area={mainArea} slot="main" />
        </Show>
        <Show when={subShown()}>
          <Resizer
            axis="x"
            direction={-1}
            value={() => prefs().subWidth}
            apply={(size) => {
              const clamped = Math.min(960, Math.max(240, size));
              shell.updatePrefs((prefs) => { prefs.subWidth = clamped; });
            }}
          />
        </Show>
        <div class="sub-pane" data-closed={!subShown() || undefined}>
          <Show
            when={shell.subRef()}
            fallback={<p class="area-view-empty">Subに表示するAreaを選んでください</p>}
          >
            <AreaView area={subArea} slot="sub" />
          </Show>
        </div>
      </WorkShape>
      <StatusBar />
      <DragGhost area={mainArea} />
      <DragGhost area={subArea} />
    </main>
  );
}
