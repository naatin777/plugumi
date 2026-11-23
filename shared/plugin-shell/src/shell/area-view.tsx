// 1つのAreaの表示（designs/00005「Areaの中身」）。左の列で選ばれたAreaの
// workspaceを、dock構成（left / center / bottom / right）で描く。
// 表示形式 "center" はdockをdata-closedで畳むだけ — Panelの配置は保つ。
import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { AreaController } from "./controller.tsx";
import type { ListSlot } from "../layout/area-list.ts";
import { AreaContext, useShell } from "./controller.tsx";
import { Dock } from "./dock.tsx";
import { CenterView } from "./center.tsx";

export function AreaView(props: { area: AreaController; slot: ListSlot }): JSX.Element {
  const shell = useShell();
  const prefs = () => shell.prefs();
  const display = () => shell.displayOf(props.area.ref(), props.slot);
  // dockの開閉はdata-closedで幅0に畳む（unmountしない — Panel状態を保つ上に
  // 畳み込みアニメが効く）。display "center" では全dockを畳む。
  const dockShown = (kind: "left" | "bottom" | "right") =>
    display() !== "center" && prefs().dockOpen[kind];

  return (
    <AreaContext value={props.area}>
      <div
        class="area-view"
        data-display={display()}
        onPointerDown={() => shell.setFocusedArea(props.area)}
      >
        <Dock kind="left" closed={!dockShown("left")} />
        <CenterView />
        <Dock kind="right" closed={!dockShown("right")} />
        <Dock kind="bottom" closed={!dockShown("bottom")} />
      </div>
    </AreaContext>
  );
}

// Mainに表示するAreaが無い（URLがAreaを指していない）ときの案内。
export function AreaEmpty(): JSX.Element {
  return (
    <div class="area-view" data-empty>
      <p class="area-view-empty">
        Areaを選んでください。左のArea listの「＋ Areaを追加」から追加できます。
      </p>
    </div>
  );
}

// AreaControllerのdrag ghost。AreaViewの外に出ても追従するようwindowで追う
// dragの結果なので、表示だけ各AreaViewにぶら下げる。
export function DragGhost(props: { area: AreaController }): JSX.Element {
  return (
    <Show when={props.area.ghost()}>
      {(ghost) => (
        <div class="drag-ghost" style={{ left: `${ghost().x + 8}px`, top: `${ghost().y + 8}px` }}>
          {ghost().title}
        </div>
      )}
    </Show>
  );
}
