// pinned領域: Areaをまたいで常時見えるwidget（designs/00005）。
// SigmaOS型 — 上が行リスト（side）、下が選択中widgetの中身（main）。
// 中身を出すのはselectedの1つだけ。行はclickで選択、dragで並べ替え。
// dropは行リストが1つのtesterで引き受け、y位置から挿入indexを決める。
import { For, Show, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { PinnedWidget } from "../layout/model.ts";
import { selectPinned } from "../layout/model.ts";
import { useShell, layoutOps } from "./controller.tsx";
import type { PanelInstance } from "../panels/instance.ts";
import { ActivityProgress, PanelState } from "./panel-mount.tsx";
import { Resizer } from "./resizer.tsx";
import { columnTest } from "./drag.ts";
import { surfaceAttrs, busyAttr } from "./activity.ts";
import { IconClose, IconPlus } from "../icons.tsx";

export function PinnedBoard(): JSX.Element {
  const shell = useShell();
  const widgets = () => shell.layout().pinned.widgets;
  const selected = () => shell.layout().pinned.selected;
  const current = () =>
    widgets().find((widget) => widget.panel.instanceId === selected());
  let unregister: (() => void) | undefined;
  onCleanup(() => unregister?.());
  const register = (node: HTMLElement) => {
    unregister?.();
    unregister = shell.drag.register(
      node,
      columnTest((index) => ({ region: "pinned", index })),
    );
  };
  return (
    <>
      {/* 列の幅のresizer。boardの子にするとinsertIndexの数え対象に
          混ざるのでaside直下に置く。 */}
      <Resizer
        axis="x"
        direction={-1}
        value={() => shell.prefs().pinnedWidth}
        apply={(size) => {
          const clamped = Math.min(640, Math.max(120, size));
          shell.updatePrefs((prefs) => {
            prefs.pinnedWidth = clamped;
          });
        }}
      />
      <div class="pinned-board">
        <div class="pin-list" ref={register}>
          <For each={widgets()}>
            {(widget) => (
              <PinRow widget={widget} selected={widget.panel.instanceId === selected()} />
            )}
          </For>
          {/* widgetはpanelと別物で相互変換しない。追加はpickerから新規に作る。 */}
          <button
            class="pin-add"
            onClick={() => shell.openPicker({ region: "pinned", index: -1 })}
          >
            <IconPlus size={12} /> Widgetを追加
          </button>
        </div>
        <div class="pin-main">
          <Show
            when={current()}
            fallback={<div class="pinned-empty">常時表示するPanelを＋で追加できます</div>}
          >
            {(widget) => <WidgetMount instance={shell.instance(widget().panel)} />}
          </Show>
        </div>
      </div>
    </>
  );
}

// sideの1行。clickで選択、動かせばdrag（並べ替え）。
function PinRow(props: { widget: PinnedWidget; selected: boolean }): JSX.Element {
  const shell = useShell();
  const ops = layoutOps(shell);
  const instance = () => shell.instance(props.widget.panel);

  const press = (event: PointerEvent) => {
    if (event.button !== 0) return;
    shell.drag.start(
      { instanceId: props.widget.panel.instanceId, title: instance().title(), kind: "widget" },
      event,
      {
        onClick: () =>
          shell.applyLayout((state) => selectPinned(state, props.widget.panel.instanceId)),
      },
    );
  };

  return (
    <div
      class="pin-row"
      data-selected={props.selected || undefined}
      {...surfaceAttrs(instance().activity(), "header")}
      {...busyAttr(instance().activity())}
      onPointerDown={press}
    >
      <span class="pin-title">{instance().title()}</span>
      <button
        class="tab-close"
        aria-label="閉じる"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          ops.close(props.widget.panel.instanceId);
        }}
      >
        <IconClose size={12} />
      </button>
    </div>
  );
}

// widgetの中身のmount枠。host・状態表示・進捗帯を束ねる。
// 面はpin-mainが敷き、カードは持たない。
function WidgetMount(props: { instance: PanelInstance }): JSX.Element {
  const host = props.instance.host;
  return (
    <div class="widget-mount">
      <ActivityProgress instance={props.instance} />
      <PanelState instance={props.instance} />
      {host}
    </div>
  );
}
