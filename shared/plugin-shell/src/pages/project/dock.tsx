import { For, type JSX } from "solid-js";
import type { PanelEntry, PanelRef } from "../../host";
import { PanelInstance } from "../../panels/instance";
import { PanelHost } from "./workspace";
import { TabScroller } from "./scroll";
import { trackPointer } from "./pointer";
import { actEffectOf, actLayerOf, actToneOf, cardInst } from "./activity";
import type { DockData } from "./model";

export function Resizer(props: { vertical?: boolean }) {
  const MIN = 120;
  const onPointerDown = (event: PointerEvent) => {
    const handle = event.currentTarget as HTMLElement;
    const container = handle.parentElement;
    const prev = handle.previousElementSibling;
    const next = handle.nextElementSibling;
    if (!container || !(prev instanceof HTMLElement) || !(next instanceof HTMLElement)) return;
    event.preventDefault();
    const size = (el: HTMLElement) =>
      props.vertical ? el.getBoundingClientRect().height : el.getBoundingClientRect().width;
    // flexを書き換えると兄弟の幅が変わるので、書き換え前に全員の幅を採取する。
    const sizes = new Map<HTMLElement, number>();
    for (const child of Array.from(container.children)) {
      if (!(child instanceof HTMLElement) || child.classList.contains("resizer")) continue;
      sizes.set(child, size(child));
    }
    for (const [child, w] of sizes) child.style.flex = `${w} 1 0px`;
    const start = props.vertical ? event.clientY : event.clientX;
    const startA = sizes.get(prev) ?? 0;
    const startB = sizes.get(next) ?? 0;
    trackPointer(handle, event, (ev) => {
      const pos = props.vertical ? ev.clientY : ev.clientX;
      const delta = Math.min(Math.max(pos - start, MIN - startA), startB - MIN);
      prev.style.flexGrow = String(startA + delta);
      next.style.flexGrow = String(startB - delta);
    });
  };
  return (
    <div
      class="resizer"
      classList={{ vertical: props.vertical }}
      onPointerDown={onPointerDown}
    />
  );
}

// 1つのDock: Panelタブ＋「+」picker＋各Instanceのhost。
export function DockView(props: {
  kind: string;
  data: DockData;
  panels: PanelEntry[];
  instance: (ref: PanelRef) => PanelInstance;
  onClose: (ref: PanelRef) => void;
  onSelect: (ref: PanelRef) => void;
  onPressTab?: (ref: PanelRef, event: PointerEvent) => void;
  collapsed?: boolean;
  trailing?: JSX.Element;
}) {
  const cardInstance = () => cardInst(props.instance, props.data.panels, props.data.selected);
  return (
    <div class={`dock dock-${props.kind}`} classList={{ collapsed: props.collapsed }}>
      {/* tab stripはcardのheaderとして輪郭の内側に入れる。
         tab+panel=1枚のcard、stripとcontentの間のhairlineがdivider面。 */}
      <div
        class="dock-card"
        attr:data-activity-tone={cardInstance() && actToneOf(cardInstance()!)}
        attr:data-activity-border={cardInstance() && actEffectOf(cardInstance()!, "border")}
        attr:data-activity-busy={cardInstance()?.activity()?.busy || undefined}
      >
      <div class="dock-tabs">
        <TabScroller>
          <For each={props.data.panels}>
            {(ref) => {
              const instance = () => props.instance(ref);
              return (
                <button
                  class="shell-tab"
                  classList={{ active: props.data.selected === ref.instanceId }}
                  attr:data-activity-tone={actLayerOf(instance(), "header")?.tone}
                  attr:data-activity-busy={instance().activity()?.busy || undefined}
                  onPointerDown={(e) => props.onPressTab?.(ref, e)}
                  onClick={() => props.onSelect(ref)}
                >
                  {instance().title}
                  <span
                    class="close" role="button" aria-label="close"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onClose(ref);
                    }}
                  >
                    ×
                  </span>
                </button>
              );
            }}
          </For>
        </TabScroller>
        {props.trailing}
      </div>
      <div class="dock-hosts">
        <For each={props.data.panels}>
          {(ref) => {
            const instance = props.instance(ref);
            return (
              <PanelHost
                instance={instance}
                hidden={props.data.selected !== ref.instanceId}
                panels={props.panels}
              />
            );
          }}
        </For>
      </div>
      </div>
    </div>
  );
}

// Shelf列: 全Panelを同時に見せるためtabではなくheader付きsectionを積層する。
// 「見ながら作業したい」が用途なので排他表示はしない（floatもしない決定）。
