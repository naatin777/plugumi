import { For, Show } from "solid-js";
import type { PanelEntry, PanelRef } from "../../host";
import { PanelInstance } from "../../panels/instance";
import { PanelHost } from "./workspace";
import { trackPointer } from "./pointer";
import { actEffectOf, actLayerOf, actToneOf } from "./activity";
import type { DockData } from "./model";

export function ShelfColumn(props: {
  data: DockData;
  panels: PanelEntry[];
  instance: (ref: PanelRef) => PanelInstance;
  onToggle: (ref: PanelRef) => void;
  onUnpin: (ref: PanelRef) => void;
  onPressTab?: (ref: PanelRef, event: PointerEvent) => void;
  onSyncGrows: (grows: Record<string, number>) => void;
}) {
  let sectionsEl: HTMLDivElement | undefined;
  const secOf = (id: string) => props.data.sections?.[id] ?? {};
  // 自分より前にexpanded sectionがあればresizerを引く。
  const expandedBefore = (index: number) =>
    props.data.panels.slice(0, index).some((panel) => !secOf(panel.instanceId).collapsed);
  const syncGrows = () => {
    const grows: Record<string, number> = {};
    sectionsEl
      ?.querySelectorAll<HTMLElement>(".shelf-section:not(.collapsed)")
      .forEach((el) => {
        const id = el.dataset.inst;
        if (id) grows[id] = parseFloat(el.style.flexGrow) || 1;
      });
    props.onSyncGrows(grows);
  };
  return (
    <div class="dock dock-shelf shelf-col">
      <div class="shelf-sections" ref={sectionsEl}>
        <For each={props.data.panels}>
          {(ref, index) => {
            const instance = () => props.instance(ref);
            const sec = () => secOf(ref.instanceId);
            return (
              <>
                <Show when={index() > 0 && !sec().collapsed && expandedBefore(index())}>
                  <ShelfResizer onEnd={syncGrows} />
                </Show>
                <section
                  class="shelf-section dock-card ws-col-card"
                  attr:data-activity-tone={actToneOf(instance())}
                  attr:data-activity-border={actEffectOf(instance(), "border")}
                  attr:data-activity-busy={instance().activity()?.busy || undefined}
                  classList={{ collapsed: !!sec().collapsed }}
                  data-inst={ref.instanceId}
                  style={
                    sec().collapsed ? undefined : { flex: `${sec().grow ?? 1} 1 0px` }
                  }
                >
                  {/* sectionもdockのPanel cardと同じ構造: tab header + Panel host。
                     tab clickでcollapseを切り替え、×でWorkspaceへ戻す。 */}
                  <div class="dock-tabs">
                    <button
                      class="shell-tab"
                      classList={{ active: !sec().collapsed }}
                      attr:data-activity-tone={actLayerOf(instance(), "header")?.tone}
                      attr:data-activity-busy={instance().activity()?.busy || undefined}
                      onPointerDown={(e) => props.onPressTab?.(ref, e)}
                      onClick={() => props.onToggle(ref)}
                    >
                      {instance().title}
                      <span
                        class="close" role="button" aria-label="unpin"
                        title="Shelfを外してWorkspaceへ戻す"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onUnpin(ref);
                        }}
                      >
                        ×
                      </span>
                    </button>
                  </div>
                  <Show when={!sec().collapsed}>
                    <PanelHost instance={instance()} panels={props.panels} />
                  </Show>
                </section>
              </>
            );
          }}
        </For>
        <Show when={props.data.panels.length === 0}>
          <p class="shelf-empty meta">PanelをShelfへdrag</p>
        </Show>
      </div>
    </div>
  );
}

// 上下に積まれたexpanded sectionの高さ比を変えるハンドル。
// 汎用Resizerと同じく全sectionを現在px＝flex-growに固定してからprev/nextを増減する。
export function ShelfResizer(props: { onEnd: () => void }) {
  const MIN = 80;
  const onPointerDown = (event: PointerEvent) => {
    const handle = event.currentTarget as HTMLElement;
    const container = handle.parentElement;
    const prev = handle.previousElementSibling;
    const next = handle.nextElementSibling;
    if (!container || !(prev instanceof HTMLElement) || !(next instanceof HTMLElement)) return;
    event.preventDefault();
    const sizes = new Map<HTMLElement, number>();
    for (const child of Array.from(container.children)) {
      if (
        !(child instanceof HTMLElement)
        || !child.classList.contains("shelf-section")
        || child.classList.contains("collapsed")
      ) continue;
      sizes.set(child, child.getBoundingClientRect().height);
    }
    const startA = sizes.get(prev);
    const startB = sizes.get(next);
    if (startA === undefined || startB === undefined) return;
    for (const [child, h] of sizes) child.style.flex = `${h} 1 0px`;
    const startY = event.clientY;
    trackPointer(
      handle, event,
      (ev) => {
        const delta = Math.min(Math.max(ev.clientY - startY, MIN - startA), startB - MIN);
        prev.style.flexGrow = String(startA + delta);
        next.style.flexGrow = String(startB - delta);
      },
      () => props.onEnd(),
    );
  };
  return <div class="resizer vertical" onPointerDown={onPointerDown} />;
}

// Areaのツリー。展開/選択/子作成/削除。
