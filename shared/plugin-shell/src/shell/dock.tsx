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
  let el!: HTMLElement;
  onCleanup(() => unregister?.());
  const register = (node: HTMLElement) => {
    el = node;
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
      {/* drawer時はdock自体が端にぴったり付く「台」になり、その内側に
          このタイルを載せる。常設のwrapperにすることでdrawer⇔inlineの
          切替でPanel Instanceをunmountしない。 */}
      <div
        class="dock-inner"
        // カードの枠は選択中のPanelのactivityを写す（drawer時も台ではなく
        // タイルに付くようinnerに置く）。
        {...surfaceAttrs(selectedActivity(), "border")}
        {...busyAttr(selectedActivity())}
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
      </div>
      <Resizer
        axis={horizontal() ? "y" : "x"}
        direction={props.kind === "left" ? 1 : -1}
        value={() => shell.prefs().dockSize[props.kind]}
        apply={(size) => {
          // drawerでも同じdockSizeを共有する。上限は台の上限（幅85cqw・
          // 高さ70cqh。台 = dockSize + --area-pad*2 なのでpad分引く）で
          // clampし、上限を越えた値を保存しない。
          const view = el.closest(".area-view");
          const pad = 2 * parseFloat(getComputedStyle(el).paddingTop);
          const max = props.drawer
            ? (horizontal()
                ? 0.70 * (view?.clientHeight ?? 0)
                : 0.85 * (view?.clientWidth ?? 0)) - pad
            : horizontal() ? 480 : 640;
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
