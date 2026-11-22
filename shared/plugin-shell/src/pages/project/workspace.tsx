import { For, onCleanup, Show } from "solid-js";
import { ChevronLeft, ChevronRight } from "lucide-solid";
import type { PanelEntry, PanelRef, WsLeaf, WsNode } from "../../host";
import { PanelInstance } from "../../panels/instance";
import { TabScroller } from "./scroll";
import { trackPointer } from "./pointer";
import { actEffectOf, actLayerOf, actProgressOf, actToneOf, cardInst } from "./activity";

// Workspace共通のprops。treeのleafがdisplayに応じてtab stack／scroll rowを描く。
export interface WsViewProps {
  panels: PanelEntry[];
  instance: (ref: PanelRef) => PanelInstance;
  onClose: (ref: PanelRef) => void;
  onSelect: (ref: PanelRef) => void;
  onPressTab: (ref: PanelRef, event: PointerEvent) => void;
  onRatio: (nodeId: string, ratio: number) => void;
}

// split treeの再帰描画。leafはdisplayで見せ方を切り替える。
export function WsTree(props: { node: WsNode } & WsViewProps) {
  return (
    <Show
      when={props.node.kind === "split" ? props.node : undefined}
      fallback={
        <WsLeafView
          leaf={props.node as WsLeaf}
          panels={props.panels}
          instance={props.instance}
          onClose={props.onClose}
          onSelect={props.onSelect}
          onPressTab={props.onPressTab}
        />
      }
    >
      {(split) => (
        <div class="ws-node" classList={{ "ws-node-y": split().axis === "y" }}>
          <div class="ws-branch" style={{ flex: `${split().ratio} 1 0` }}>
            <WsTree {...props} node={split().first} />
          </div>
          <RatioResizer axis={split().axis} onRatio={(ratio) => props.onRatio(split().id, ratio)} />
          <div class="ws-branch" style={{ flex: `${1 - split().ratio} 1 0` }}>
            <WsTree {...props} node={split().second} />
          </div>
        </div>
      )}
    </Show>
  );
}

// leafの見せ方はdisplayに従う: tabs=tab stack、scroll=横並び列。
// data-displayはDnDのhitTestがleafの表示形態を知るために載せる。
function WsLeafView(props: {
  leaf: WsLeaf;
  panels: PanelEntry[];
  instance: (ref: PanelRef) => PanelInstance;
  onClose: (ref: PanelRef) => void;
  onSelect: (ref: PanelRef) => void;
  onPressTab: (ref: PanelRef, event: PointerEvent) => void;
}) {
  return (
    <div class="ws-area" data-area-id={props.leaf.id} data-display={props.leaf.display}>
      <Show
        when={props.leaf.display !== "tabs"}
        fallback={<WsTabsArea leaf={props.leaf} panels={props.panels} instance={props.instance} onClose={props.onClose} onSelect={props.onSelect} onPressTab={props.onPressTab} />}
      >
        <Show
          when={props.leaf.display === "pages"}
          fallback={<WsScrollArea leaf={props.leaf} panels={props.panels} instance={props.instance} onClose={props.onClose} onSelect={props.onSelect} onPressTab={props.onPressTab} />}
        >
          <WsPagesArea leaf={props.leaf} panels={props.panels} instance={props.instance} onClose={props.onClose} onSelect={props.onSelect} onPressTab={props.onPressTab} />
        </Show>
      </Show>
    </div>
  );
}

// tabs表示: tab帯＋選択中Panelのカード。
function WsTabsArea(props: {
  leaf: WsLeaf;
  panels: PanelEntry[];
  instance: (ref: PanelRef) => PanelInstance;
  onClose: (ref: PanelRef) => void;
  onSelect: (ref: PanelRef) => void;
  onPressTab: (ref: PanelRef, event: PointerEvent) => void;
}) {
  const cardInstance = () => cardInst(props.instance, props.leaf.panels, props.leaf.selected);
  return (
    <div
      class="dock-card ws-col-card"
      attr:data-activity-tone={cardInstance() && actToneOf(cardInstance()!)}
      attr:data-activity-border={cardInstance() && actEffectOf(cardInstance()!, "border")}
      attr:data-activity-busy={cardInstance()?.activity()?.busy || undefined}
    >
      <div class="dock-tabs">
        <TabScroller>
          <For each={props.leaf.panels}>
            {(ref) => {
              const instance = () => props.instance(ref);
              return (
                <button
                  class="shell-tab"
                  classList={{ active: props.leaf.selected === ref.instanceId }}
                  attr:data-activity-tone={actLayerOf(instance(), "header")?.tone}
                  attr:data-activity-busy={instance().activity()?.busy || undefined}
                  onPointerDown={(e) => props.onPressTab(ref, e)}
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
      </div>
      <WsPanelHosts area={props.leaf} panels={props.panels} instance={props.instance} />
    </div>
  );
}

// pages表示: headerはtabs表示と同じ「全Panelのtab strip」で固定され、
// 横scrollで変わるのは領域の中身（page scroller）だけ。各pageはleaf幅いっぱいの
// Panel面で、scroll-snapでpage単位に吸着する。
function WsPagesArea(props: {
  leaf: WsLeaf;
  panels: PanelEntry[];
  instance: (ref: PanelRef) => PanelInstance;
  onClose: (ref: PanelRef) => void;
  onSelect: (ref: PanelRef) => void;
  onPressTab: (ref: PanelRef, event: PointerEvent) => void;
}) {
  const cardInstance = () => cardInst(props.instance, props.leaf.panels, props.leaf.selected);
  let pagesEl: HTMLDivElement | undefined;
  const focusPage = (ref: PanelRef) => {
    props.onSelect(ref);
    pagesEl
      ?.querySelector(`[data-inst="${ref.instanceId}"]`)
      ?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  };

  // 横scrollで見えているpageをselectedへ追従させる。scroll中の中間pageで
  // 選択が踊らないよう、停止直後の1回だけ反映する。
  let scrollTimer: number | undefined;
  const onPagesScroll = () => {
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      if (!pagesEl || pagesEl.clientWidth === 0) return;
      const idx = Math.round(pagesEl.scrollLeft / pagesEl.clientWidth);
      const ref = props.leaf.panels[Math.max(0, Math.min(idx, props.leaf.panels.length - 1))];
      if (ref && ref.instanceId !== props.leaf.selected) props.onSelect(ref);
    }, 120);
  };
  onCleanup(() => window.clearTimeout(scrollTimer));

  return (
    <div
      class="dock-card ws-col-card"
      attr:data-activity-tone={cardInstance() && actToneOf(cardInstance()!)}
      attr:data-activity-border={cardInstance() && actEffectOf(cardInstance()!, "border")}
      attr:data-activity-busy={cardInstance()?.activity()?.busy || undefined}
    >
      <div class="dock-tabs">
        <TabScroller>
          <For each={props.leaf.panels}>
            {(ref) => {
              const instance = () => props.instance(ref);
              return (
                <button
                  class="shell-tab"
                  classList={{ active: props.leaf.selected === ref.instanceId }}
                  attr:data-activity-tone={actLayerOf(instance(), "header")?.tone}
                  attr:data-activity-busy={instance().activity()?.busy || undefined}
                  onPointerDown={(e) => props.onPressTab(ref, e)}
                  onClick={() => focusPage(ref)}
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
      </div>
      {/* page scroller: headerは動かず、この内部だけが横に変わる。 */}
      <div class="ws-pages" ref={(el) => (pagesEl = el)} onScroll={onPagesScroll}>
        <For each={props.leaf.panels}>
          {(ref) => (
            <div class="ws-page" data-inst={ref.instanceId} classList={{ active: props.leaf.selected === ref.instanceId }}>
              <PanelHost instance={props.instance(ref)} panels={props.panels} />
            </div>
          )}
        </For>
        <Show when={props.leaf.panels.length > 1}>
          <button class="dock-scroll ws-edge left" onClick={() => pagesEl?.scrollBy({ left: -(pagesEl.clientWidth || 0), behavior: "smooth" })}>
            <ChevronLeft size={12} />
          </button>
          <button class="dock-scroll ws-edge right" onClick={() => pagesEl?.scrollBy({ left: pagesEl.clientWidth || 0, behavior: "smooth" })}>
            <ChevronRight size={12} />
          </button>
        </Show>
      </div>
    </div>
  );
}

// scroll表示: headerはpagesと同じ固定tab strip。中身はleaf幅いっぱいではない
// Panel itemが横に並ぶscroll帯で、item間は垂直divider（dragで幅調整）。
// activeはleaf.selectedの1つだけ — scroll停止時に先頭付近で見えているitemへ追従する。
function WsScrollArea(props: {
  leaf: WsLeaf;
  panels: PanelEntry[];
  instance: (ref: PanelRef) => PanelInstance;
  onClose: (ref: PanelRef) => void;
  onSelect: (ref: PanelRef) => void;
  onPressTab: (ref: PanelRef, event: PointerEvent) => void;
}) {
  const cardInstance = () => cardInst(props.instance, props.leaf.panels, props.leaf.selected);
  let stripEl: HTMLDivElement | undefined;
  const focusItem = (ref: PanelRef) => {
    props.onSelect(ref);
    stripEl
      ?.querySelector(`[data-inst="${ref.instanceId}"]`)
      ?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  };

  // scroll停止時にselectedを「一番見えているitem」へ追従させる。
  // item幅はdividerで可変なので、indexではなく各itemのrectから重なり量を見る。
  let scrollTimer: number | undefined;
  const onStripScroll = () => {
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      if (!stripEl) return;
      const viewLeft = stripEl.scrollLeft;
      const viewRight = viewLeft + stripEl.clientWidth;
      let best: string | undefined;
      let bestOverlap = 0;
      for (const el of stripEl.querySelectorAll<HTMLElement>(".ws-item")) {
        const overlap = Math.min(el.offsetLeft + el.offsetWidth, viewRight) - Math.max(el.offsetLeft, viewLeft);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = el.dataset.inst;
        }
      }
      const ref = props.leaf.panels.find((panel) => panel.instanceId === best);
      if (ref && ref.instanceId !== props.leaf.selected) props.onSelect(ref);
    }, 120);
  };
  onCleanup(() => window.clearTimeout(scrollTimer));

  return (
    <div
      class="dock-card ws-col-card"
      attr:data-activity-tone={cardInstance() && actToneOf(cardInstance()!)}
      attr:data-activity-border={cardInstance() && actEffectOf(cardInstance()!, "border")}
      attr:data-activity-busy={cardInstance()?.activity()?.busy || undefined}
    >
      <div class="dock-tabs">
        <TabScroller>
          <For each={props.leaf.panels}>
            {(ref) => {
              const instance = () => props.instance(ref);
              return (
                <button
                  class="shell-tab"
                  classList={{ active: props.leaf.selected === ref.instanceId }}
                  attr:data-activity-tone={actLayerOf(instance(), "header")?.tone}
                  attr:data-activity-busy={instance().activity()?.busy || undefined}
                  onPointerDown={(e) => props.onPressTab(ref, e)}
                  onClick={() => focusItem(ref)}
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
      </div>
      <div class="ws-items" ref={(el) => (stripEl = el)} onScroll={onStripScroll}>
        <For each={props.leaf.panels}>
          {(ref) => (
            <>
              <div class="ws-item" data-inst={ref.instanceId} classList={{ active: props.leaf.selected === ref.instanceId }}>
                <PanelHost instance={props.instance(ref)} panels={props.panels} />
              </div>
              {/* dividerはitemの「右端ハンドル」。最後のitemにも付くので
                 全itemがresizeできる。 */}
              <div class="resizer ws-divider" onPointerDown={(event) => {
                const handle = event.currentTarget as HTMLElement;
                const prev = handle.previousElementSibling;
                if (!(prev instanceof HTMLElement)) return;
                event.preventDefault();
                const startX = event.clientX;
                const startW = prev.getBoundingClientRect().width;
                trackPointer(handle, event, (ev) => {
                  // flex:noneで等分から外し、px widthで固定する。
                  prev.style.flex = "none";
                  prev.style.width = `${Math.max(160, startW + (ev.clientX - startX))}px`;
                });
              }} />
            </>
          )}
        </For>
      </div>
    </div>
  );
}

// leafのPanel host群。selected以外はhiddenのままInstanceを保持する。
function WsPanelHosts(props: {
  area: { panels: PanelRef[]; selected?: string };
  panels: PanelEntry[];
  instance: (ref: PanelRef) => PanelInstance;
}) {
  return (
    <div class="dock-hosts">
      <For each={props.area.panels}>
        {(ref) => (
          <PanelHost
            instance={props.instance(ref)}
            hidden={props.area.selected !== undefined && props.area.selected !== ref.instanceId}
            panels={props.panels}
          />
        )}
      </For>
    </div>
  );
}

// 1つのPanel host。activity属性とmissing/error表示を持つ共通の面。
export function PanelHost(props: { instance: PanelInstance; hidden?: boolean; panels?: PanelEntry[] }) {
  const instance = props.instance;
  return (
    <div
      class="dock-panel"
      classList={{ hidden: props.hidden }}
      attr:data-activity-tone={actToneOf(instance)}
      attr:data-activity-busy={instance.activity()?.busy || undefined}
      attr:aria-busy={instance.activity()?.busy || undefined}
      attr:data-activity-border={actEffectOf(instance, "border")}
      attr:data-activity-divider={actEffectOf(instance, "divider")}
      attr:data-activity-content={actEffectOf(instance, "content")}
      style={actProgressOf(instance)}
    >
      {instance.host}
      <Show when={instance.state() === "missing"}>
        <div class="panel-message"><p>提供元のPluginが見つかりません</p></div>
      </Show>
      <Show when={instance.error()}>
        {(mountError) => (
          <div class="panel-message">
            <p><span class="kind">{mountError().kind}</span>: {mountError().message}</p>
            <Show when={props.panels}>
              {(panels) => <button onClick={() => instance.retry(panels())}>再試行</button>}
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

// split nodeのratioをdragで変えるresizer。親コンテナ（.ws-node）の
// 座標系で割合を計算し、onRatioで状態に書き戻す（再描画で位置が確定する）。
function RatioResizer(props: { axis: "x" | "y"; onRatio: (ratio: number) => void }) {
  const onPointerDown = (event: PointerEvent) => {
    const handle = event.currentTarget as HTMLElement;
    const container = handle.parentElement;
    if (!container) return;
    event.preventDefault();
    trackPointer(handle, event, (ev) => {
      const rect = container.getBoundingClientRect();
      const ratio = props.axis === "x"
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height;
      props.onRatio(ratio);
    });
  };
  return (
    <div
      class="resizer"
      classList={{ vertical: props.axis === "y" }}
      onPointerDown={onPointerDown}
    />
  );
}
