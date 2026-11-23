// left/right/bottom/pinnedの縁領域（位置の契約）。tab切替の1列。
// pinnedはProject-scopeでworkspaceの外にあるだけで、見た目と操作は同じ。
// 開いているときだけdrop先になる（閉じたdockはregisterしない）。
import { Show, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { DockKind, MoveTarget } from "../layout/model.ts";
import { PanelInstance } from "../panels/instance.ts";
import { useShell, layoutOps } from "./controller.tsx";
import { TabStrip } from "./tab-strip.tsx";
import { PagesTrack, flipPage, pageMouse } from "./pages.tsx";
import { Resizer } from "./resizer.tsx";
import { bodyTest } from "./drag.ts";
import { surfaceAttrs, busyAttr, dividerAttr } from "./activity.ts";

// workspaceのstackを持つ領域と、Project単位で別に保存されるpinnedを
// 同じコンポーネントで描く。MoveTargetの形だけが違う。
export type DockRegion = DockKind | "pinned";

export function Dock(props: { kind: DockRegion }): JSX.Element {
  const shell = useShell();
  const stack = () =>
    props.kind === "pinned"
      ? shell.layout().pinned
      : shell.layout().workspace[props.kind];
  const horizontal = () => props.kind === "bottom";
  const target = (index: number): MoveTarget =>
    props.kind === "pinned"
      ? { region: "pinned", index }
      : { region: "dock", dock: props.kind, index };

  let unregister: (() => void) | undefined;
  onCleanup(() => unregister?.());
  const register = (node: HTMLElement) => {
    unregister?.();
    unregister = shell.drag.register(node, bodyTest(target(-1)));
  };

  const ops = layoutOps(shell);
  const selected = () => stack().panels.find((ref) => ref.instanceId === stack().selected);
  const selectedActivity = () => {
    const ref = selected();
    return ref ? shell.instance(ref).activity() : undefined;
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
      style={horizontal()
        ? { height: `${shell.prefs().dockSize.bottom}px` }
        : props.kind === "pinned"
          // pinnedの幅はaside（--pinned-width）が決める。カードはinsetの中を
          // 埋めるだけなので自分で幅を持たない（持つとpadding分だけ欠ける）。
          ? { width: "100%" }
          : { width: `${shell.prefs().dockSize[props.kind]}px` }}
      ref={register}
      onMouseDown={pageMouse(flip)}
      // 戻る/進むボタンのhistory遷移を止める（flipはmousedownの1回だけ）
      onMouseUp={(event) => {
        if (event.button === 3 || event.button === 4) event.preventDefault();
      }}
      onAuxClick={(event) => event.preventDefault()}
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
        value={() =>
          props.kind === "pinned"
            ? shell.prefs().pinnedWidth
            : shell.prefs().dockSize[props.kind]
        }
        apply={(size) => {
          const max = horizontal() ? 480 : 640;
          const min = horizontal() ? 80 : 120;
          const clamped = Math.min(max, Math.max(min, size));
          shell.updatePrefs((prefs) => {
            if (props.kind === "pinned") {
              prefs.pinnedWidth = clamped;
            } else {
              const kind: DockKind = props.kind;
              prefs.dockSize = { ...prefs.dockSize, [kind]: clamped };
            }
          });
        }}
      />
    </section>
  );
}

// Panel InstanceのhostをDOMへ据える。表示側は毎回同じhostを差すだけ。
// activityのborder/dividerはカードとstripが受け持つ（contentは列やbody側）。
export function PanelMount(props: { instance: PanelInstance }): JSX.Element {
  const host = props.instance.host;
  return (
    <div class="panel-frame">
      <ActivityProgress instance={props.instance} />
      <PanelState instance={props.instance} />
      {host}
    </div>
  );
}

// determinate/indeterminateの進捗。header/divider面の位置に細い帯で出す。
function ActivityProgress(props: { instance: PanelInstance }): JSX.Element {
  const progress = () => props.instance.activity()?.progress;
  return (
    <Show when={progress()}>
      {(value) => (
        <div
          class="activity-progress"
          data-kind={value().kind}
          style={value().kind === "determinate"
            ? { width: `${Math.min(100, Math.max(0, (value() as { kind: "determinate"; value: number }).value * 100))}%` }
            : undefined}
        />
      )}
    </Show>
  );
}

// mounting/missing/errorの表示。hostは常に残し、tab切替ではDOMを壊さない。
export function PanelState(props: { instance: PanelInstance }): JSX.Element {
  const shell = useShell();
  return (
    <Show when={props.instance.state() !== "mounted" || props.instance.error()}>
      <div class="panel-state">
        <Show when={props.instance.error()}>
          {(error) => (
            <>
              <p>Panelを開けませんでした（{error().kind}）</p>
              <button onClick={() => props.instance.retry(shell.panels() ?? [])}>
                再試行
              </button>
            </>
          )}
        </Show>
        <Show when={!props.instance.error() && props.instance.state() === "missing"}>
          <p>このPanelを提供するPluginが見つかりません</p>
        </Show>
        <Show when={!props.instance.error() && props.instance.state() === "mounting"}>
          <p>読み込み中…</p>
        </Show>
      </div>
    </Show>
  );
}
