// pinned領域: Areaをまたいで常時見えるwidgetの縦積み（designs/00005）。
// widgetはheaderを持たず中身だけ。畳むと細い1行（indicator）になる。
// 開いている間の操作（畳み・閉じる・drag）はhoverで浮くopsが担う。
// 全員見せる形式なのでtabは持たず、溢れたら列内でscrollする。
// dropは列全体を1つのtesterで引き受け、y位置から挿入indexを決める。
import { For, Show, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { PinnedWidget } from "../layout/model.ts";
import { patchWidget } from "../layout/model.ts";
import { useShell, layoutOps } from "./controller.tsx";
import type { PanelInstance } from "../panels/instance.ts";
import { ActivityProgress, PanelState } from "./panel-mount.tsx";
import { Resizer } from "./resizer.tsx";
import { columnTest } from "./drag.ts";
import { surfaceAttrs, busyAttr, dividerAttr } from "./activity.ts";
import { ToolButton } from "./tool-button.tsx";
import { IconClose, IconChevronDown, IconChevronRight, IconGrip, IconPlus } from "../icons.tsx";

// 未指定時の中身の高さ（px）。変更はwidgetごとのresizerで行う。
const DEFAULT_WIDGET_HEIGHT = 200;
const WIDGET_MIN_HEIGHT = 96;
const WIDGET_MAX_HEIGHT = 560;

export function PinnedBoard(): JSX.Element {
  const shell = useShell();
  const widgets = () => shell.layout().pinned.widgets;
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
      {/* 列の幅のresizer。boardの子にするとcolumnIndexの数え対象に
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
      <div class="pinned-board" ref={register}>
        <For
          each={widgets()}
          fallback={
            <div class="pinned-empty">常時表示するPanelを＋で追加できます</div>
          }
        >
          {(widget) => <WidgetCard widget={widget} />}
        </For>
        {/* widgetはpanelと別物で相互変換しない。追加はpickerから新規に作る。 */}
        <button
          class="pinned-add"
          onClick={() => shell.openPicker({ region: "pinned", index: -1 })}
        >
          <IconPlus size={12} /> Widgetを追加
        </button>
      </div>
    </>
  );
}

function WidgetCard(props: { widget: PinnedWidget }): JSX.Element {
  const shell = useShell();
  const ops = layoutOps(shell);
  const instance = () => shell.instance(props.widget.panel);
  const collapsed = () => props.widget.collapsed;
  const height = () => props.widget.height ?? DEFAULT_WIDGET_HEIGHT;
  const patch = (entry: { collapsed?: boolean; height?: number | null }) =>
    shell.applyLayout((state) =>
      patchWidget(state, props.widget.panel.instanceId, entry)
    );

  // headerのpressはclickとdragを分けるcontrollerに渡す。clickなら畳み
  // 切替、動かせばdrag（regionをまたぐ移動）。
  const press = (event: PointerEvent) => {
    if (event.button !== 0) return;
    shell.drag.start(
      { instanceId: props.widget.panel.instanceId, title: instance().title(), kind: "widget" },
      event,
      { onClick: () => patch({ collapsed: !collapsed() }) },
    );
  };

  return (
    <section
      class="widget"
      data-collapsed={collapsed() || undefined}
      {...surfaceAttrs(instance().activity(), "border")}
      {...busyAttr(instance().activity())}
    >
      {/* 畳んだ状態はindicatorとしての1行。開くと行は消えて中身だけになり、
          操作はhoverで浮くopsに移る。 */}
      <Show
        when={collapsed()}
        fallback={
          <>
            <div class="widget-body" style={{ height: `${height()}px` }}>
              <WidgetMount instance={instance()} />
            </div>
            <div class="widget-ops">
              {/* gripはdrag専用（clickでは何もしない）。 */}
              <ToolButton
                class="widget-op" label="移動"
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  shell.drag.start(
                    {
                      instanceId: props.widget.panel.instanceId,
                      title: instance().title(),
                      kind: "widget",
                    },
                    event,
                  );
                }}
              >
                <IconGrip size={12} />
              </ToolButton>
              <ToolButton
                class="widget-op" label="畳む"
                onClick={() => patch({ collapsed: true })}
              >
                <IconChevronDown size={12} />
              </ToolButton>
              <ToolButton
                class="widget-op" label="閉じる"
                onClick={() => ops.close(props.widget.panel.instanceId)}
              >
                <IconClose size={12} />
              </ToolButton>
            </div>
            <Resizer
              axis="y"
              direction={1}
              value={height}
              apply={(size) => {
                patch({ height: Math.min(WIDGET_MAX_HEIGHT, Math.max(WIDGET_MIN_HEIGHT, size)) });
              }}
            />
          </>
        }
      >
        <header
          class="widget-head"
          {...surfaceAttrs(instance().activity(), "header")}
          {...dividerAttr(instance().activity())}
          onPointerDown={press}
        >
          <span class="widget-fold" aria-hidden="true">
            <IconChevronRight size={12} />
          </span>
          <span class="widget-title">{instance().title()}</span>
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
        </header>
      </Show>
    </section>
  );
}

// widgetの中身のmount枠。PanelMount（dock/leaf用のカード内面）とは別物:
// widgetはカードを持たないので、面はwidget-bodyが敷き、ここでは
// host・状態表示・進捗帯だけを束ねる。
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
