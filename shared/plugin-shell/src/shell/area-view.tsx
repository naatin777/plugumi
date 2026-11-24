// 1つのAreaの表示（designs/00005「Areaの中身」）。左の列で選ばれたAreaの
// workspaceを、dock構成（left / center / bottom / right）で描く。
// Subはcenterだけを出す — dockを描画しない（data-closedで畳むのではなく
// component自体を出さず、SubでdockのPanel Instanceをmountさせない）。
// workspaceのデータは触らないので、そのAreaをMainへ移せばdockは戻る。
// 表示形式 "center" はdockをdata-closedで畳むだけ — Panelの配置は保つ。
// 幅に応じてdata-sizeを立て、狭いときはdockがdrawerになる（dock.module.css）。
import { Show, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { AreaController } from "./controller.tsx";
import type { ListSlot } from "../layout/area-list.ts";
import type { DockKind } from "../layout/model.ts";
import { AreaContext, useShell } from "./controller.tsx";
import { Dock } from "./dock.tsx";
import { CenterView } from "./center.tsx";
import styles from "./area-view.module.css";
import controlStyles from "./controls.module.css";

export function AreaView(props: { area: AreaController; slot: ListSlot }): JSX.Element {
  const shell = useShell();
  const display = () => shell.displayOf(props.area.ref());
  // dockの開閉はdata-closedで畳む（unmountしない — Panel状態を保つ上に
  // 畳み込みアニメが効く）。display "center" では全dockを畳む。
  // 実効の開閉（prefsかdrawer signalか）はAreaControllerがsizeから決める。
  const dockClosed = (kind: DockKind) =>
    display() === "center" || !props.area.dockShown(kind);

  // 幅はResizeObserverで測りdata-sizeへ。JSでもdrawer状態を扱うので
  // container queryだけにはしない。callback内でoffsetWidth等は読まない
  // （entryの測定値をそのまま使う — work-shape.tsxと同じ注意）。
  let ro: ResizeObserver | undefined;
  onCleanup(() => ro?.disconnect());
  const observe = (node: HTMLElement) => {
    ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        props.area.setSize(w >= 1000 ? "wide" : w >= 600 ? "narrow" : "compact");
      }
    });
    ro.observe(node);
  };

  return (
    <AreaContext value={props.area}>
      <div
        class={styles["area-view"]}
        data-part="area-view"
        ref={observe}
        data-size={props.area.size()}
        data-display={display()}
        onPointerDown={() => shell.setFocusedArea(props.area)}
      >
        <Show when={props.slot === "main"}>
          {/* drawerの台のすぐ下・centerの上に敷く薄い暗幕。
              AreaView内だけを暗くする。pointerは通す（閉じるのは
              今の外click判定のまま）。 */}
          <div class={styles["dock-scrim"]} data-part="dock-scrim" data-closed={props.area.drawer() === null ? "" : undefined} />
          <Dock kind="left" closed={dockClosed("left")} drawer={props.area.dockIsDrawer("left")} />
        </Show>
        <CenterView />
        <Show when={props.slot === "main"}>
          <Dock kind="right" closed={dockClosed("right")} drawer={props.area.dockIsDrawer("right")} />
          <Dock kind="bottom" closed={dockClosed("bottom")} drawer={props.area.dockIsDrawer("bottom")} />
        </Show>
      </div>
    </AreaContext>
  );
}

// Mainに表示するAreaが無い（URLがAreaを指していない）ときの案内。
export function AreaEmpty(): JSX.Element {
  return (
    <div class={styles["area-view"]} data-empty>
      <p class={styles["area-view-empty"]}>
        Areaを選んでください。左のArea listの「＋ Areaを追加」から追加できます。
      </p>
    </div>
  );
}

// drag ghost。dragはwindowで追う（AreaViewの外に出ても追従する）。
// drag controllerはshellに1個なのでghostも1つだけ描く。
export function DragGhost(): JSX.Element {
  const shell = useShell();
  return (
    <Show when={shell.ghost()}>
      {(ghost) => (
        <div class={controlStyles["drag-ghost"]} style={{ left: `${ghost().x + 8}px`, top: `${ghost().y + 8}px` }}>
          {ghost().title}
        </div>
      )}
    </Show>
  );
}
