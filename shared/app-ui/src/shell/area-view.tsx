// 1つのAreaの表示（designs/00005「Areaの中身」）。左の列で選ばれたAreaの
// workspaceをcenterのsplit treeで描く。MainもSubも同じ形。
import { Show, For } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { AreaController } from "./controller.tsx";
import { AreaContext, useShell } from "./controller.tsx";
import type { DropPreview } from "./drag.ts";
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
    <>
      <Show when={shell.ghost()}>
        {(ghost) => (
          <div class={controlStyles["drag-ghost"]} style={{ left: `${ghost().x + 8}px`, top: `${ghost().y + 8}px` }}>
            {ghost().title}
          </div>
        )}
      </Show>
      {/* drop先のpreview。splitなら新しいleafが入る半分の矩形を
          accentで示し、挿入ならleaf全体を薄く、stripならcaretを出す */}
      <Show when={shell.dropPreview()}>
        {(preview) => <PreviewShape preview={preview()} />}
      </Show>
    </>
  );
}

// drop previewの形状。pieceの列をそのまま描く — regionはsplit/挿入を
// 色の強さで分ける。caretはregionの上に重なることがある（strip上では
// leafのregionとstripのcaretが同時に出る）。
function PreviewShape(props: { preview: DropPreview }): JSX.Element {
  return (
    <For each={props.preview}>
      {(piece) => (
        <Show
          when={piece.kind === "region"}
          fallback={
            <div
              class={controlStyles["drop-caret"]}
              style={{
                left: `${(piece as { x: number }).x - 1}px`,
                top: `${(piece as { y: number }).y}px`,
                height: `${(piece as { height: number }).height}px`,
              }}
            />
          }
        >
          <div
            class={`${controlStyles["drop-region"]} ${(piece as { split: boolean }).split ? controlStyles["split"] : ""}`}
            style={{
              left: `${piece.x}px`,
              top: `${piece.y}px`,
              width: `${(piece as { width: number }).width}px`,
              height: `${piece.height}px`,
            }}
          />
        </Show>
      )}
    </For>
  );
}
