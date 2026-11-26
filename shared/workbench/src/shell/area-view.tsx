// 1つのAreaの表示（designs/00005「Areaの中身」）。左の列で選ばれたAreaの
// workspaceをcenterのsplit treeで描く。MainもSubも同じ形。
import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { AreaController } from "./controller.tsx";
import { AreaContext, useShell } from "./controller.tsx";
import { CenterView } from "./center.tsx";
import styles from "./area-view.module.css";
import controlStyles from "./controls.module.css";

export function AreaView(props: { area: AreaController }): JSX.Element {
  const shell = useShell();
  return (
    <AreaContext value={props.area}>
      <div
        class={styles["area-view"]}
        data-part="area-view"
        onPointerDown={() => shell.setFocusedArea(props.area)}
      >
        <CenterView />
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
