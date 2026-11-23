// left/bottom/rightの縁領域（位置の契約）。tab切替の1列。
// rightは右の列。
// 開いているときだけdrop先になる（閉じたdockはregisterしない）。
import { Show, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { DockKind, MoveTarget } from "../layout/model.ts";
import { useArea, layoutOps } from "./controller.tsx";
import { TabStrip } from "./tab-strip.tsx";
import { PagesTrack, flipPage, pageNavProps } from "./pages.tsx";
import { Resizer } from "./resizer.tsx";
import { bodyTest } from "./drag.ts";
import { surfaceAttrs, busyAttr, dividerAttr } from "./activity.ts";

export function Dock(props: { kind: DockKind; closed?: boolean; drawer?: boolean }): JSX.Element {
  const area = useArea();
  const shell = area.shell;
  const stack = () => area.layout()[props.kind];
  const horizontal = () => props.kind === "bottom";
  const target = (index: number): MoveTarget =>
    ({ region: "dock", dock: props.kind, index });

  let unregister: (() => void) | undefined;
  onCleanup(() => unregister?.());
  const register = (node: HTMLElement) => {
    unregister?.();
    unregister = area.drag.register(node, bodyTest(target(-1)));
  };

  const ops = layoutOps(area);
  const selected = () => stack().panels.find((ref) => ref.instanceId === stack().selected);
  const selectedActivity = () => {
    const ref = selected();
    return ref ? area.instance(ref).activity() : undefined;
  };
  const flip = (direction: 1 | -1) => {
    const id = flipPage(stack().panels, stack().selected, direction);
    if (id) ops.select(id);
  };

  return (
    <section
      class="dock"
      data-dock={props.kind}
      // カードの枠は選択中のPanelのactivityを写す
      {...surfaceAttrs(selectedActivity(), "border")}
      {...busyAttr(selectedActivity())}
      data-closed={props.closed || undefined}
      // drawerの外click判定用。開いているdrawer自身だけを「内側」にする
      // （同じviewのcenterをclickしたら閉じる）。
      data-drawer-keep={props.drawer && !props.closed ? "" : undefined}
      // 実効の幅/高さはCSSが --dock-size から決める（drawer時は85cqw等に
      // 切り替わる）。閉じる畳み込みはdata-closed側が受け持つので、
      // ここは常に設定値を渡す（drawerはtransformだけで画面外へ逃がす）。
      style={{ "--dock-size": `${shell.prefs().dockSize[props.kind]}px` }}
      ref={register}
      {...pageNavProps(flip)}
    >
      <div class="dock-strip" {...dividerAttr(selectedActivity())}>
        <TabStrip
          refs={stack().panels}
          selected={stack().selected}
          target={target}
          onFlip={flip}
        />
      </div>
      <div class="dock-body">
        <Show
          when={stack().panels.length > 0}
          fallback={<div class="dock-empty">Panel を開くとここに表示されます</div>}
        >
          <PagesTrack refs={stack().panels} selected={stack().selected} />
        </Show>
      </div>
      <Resizer
        axis={horizontal() ? "y" : "x"}
        direction={props.kind === "left" ? 1 : -1}
        value={() => shell.prefs().dockSize[props.kind]}
        apply={(size) => {
          const max = horizontal() ? 480 : 640;
          const min = horizontal() ? 80 : 120;
          const clamped = Math.min(max, Math.max(min, size));
          shell.updatePrefs((prefs) => {
            const kind: DockKind = props.kind;
            prefs.dockSize = { ...prefs.dockSize, [kind]: clamped };
          });
        }}
      />
    </section>
  );
}
