// centerの区画。「tab帯（header）＋中身」の1枚のカード（designs/00005
// 「tab帯はカードのheader」）。中身は全領域で共用のpages track。
import { Show, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { Leaf } from "../layout/model.ts";
import { useArea } from "./controller.tsx";
import { TabStrip } from "./tab-strip.tsx";
import { PagesTrack, flipPage, pageNavProps } from "./pages.tsx";
import { leafTest } from "./drag.ts";
import { focusLeaf, selectPanel, setLeafLayout, setLeafColWidth } from "../layout/model.ts";
import { dividerAttr, surfaceAttrs, busyAttr } from "./activity.ts";
import { IconPlus, IconDeck } from "../icons.tsx";
import "./leaf.css";
import "./tab-strip.css";

export function LeafView(props: { leaf: Leaf }): JSX.Element {
  const area = useArea();
  const focused = () => area.layout().center.focusedLeaf === props.leaf.id;
  let unregister: (() => void) | undefined;
  onCleanup(() => unregister?.());
  // drop判定はleaf全体（section）に登録する — tab帯のheaderを含む
  // どこでも縁へのdropがsplitになる。strip上はstripのtesterが先に
  // 当たり、左右の縁だけfall throughしてこちらに届く。
  const registerLeaf = (node: HTMLElement) => {
    unregister?.();
    // props.leafはlive getter（loadで差し替わる）なのでidはdrop時に読む
    unregister = area.drag.register(area, node, leafTest(() => props.leaf.id));
  };
  const markFocus = () => {
    // leafのどこを触っても、「+」の足し先・前後キーの対象はこの区画になる
    if (!focused()) area.applyLayout((state) => focusLeaf(state, props.leaf.id));
  };
  // カードの枠・divider面は選択中のPanelのactivityを写す。
  const selectedInstance = () => {
    const ref = props.leaf.panels.find((entry) => entry.instanceId === props.leaf.selected);
    return ref ? area.instance(ref) : undefined;
  };
  // page切替えのscroll挙動。flip（stripの横スワイプ・マウスの戻る/進む）
  // は方向のあるpageめくりなので滑らせ、tabの直接選択やキーでは
  // 瞬時に切り替える。PagesTrackがscrollToするときに読んでinstantへ戻す。
  const scrollHint = { behavior: "instant" as "smooth" | "instant" };
  const flip = (direction: 1 | -1) => {
    const id = flipPage(props.leaf.panels, props.leaf.selected, direction);
    if (id) {
      scrollHint.behavior = "smooth";
      area.applyLayout((state) => selectPanel(state, id));
    }
  };
  const select = (index: number) => {
    const ref = props.leaf.panels[index];
    if (ref) area.applyLayout((state) => selectPanel(state, ref.instanceId));
  };
  return (
    <section
      class={{ ["leaf"]: true, ["focused"]: focused() }}
      data-part="leaf"
      ref={registerLeaf}
      onPointerDown={markFocus}
      {...pageNavProps(flip)}
      {...surfaceAttrs(selectedInstance()?.activity(), "border")}
      {...busyAttr(selectedInstance()?.activity())}
    >
      {/* surface — panelの面。leafとは別要素なので、maskで穴を開けても
          コンテンツは消えない。穴のrectは--hole-*（panel内容が書き込む）
          で、継承でここに届く。 */}
      <div class={"leaf-surface"} data-part="leaf-surface" />
      <header class={"leaf-strip"} data-part="leaf-strip" {...dividerAttr(selectedInstance()?.activity())}>
        <TabStrip
          refs={props.leaf.panels}
          selected={props.leaf.selected}
          target={(index) => ({ region: "leaf", leafId: props.leaf.id, index })}
          onFlip={flip}
        />
        {/* 列への展開。deckでは中身を固定幅の列にして横scrollで流し見する。 */}
        <button
          class={`plugumi-icon-button ${"strip-deck"}`}
          data-part="deck-toggle"
          aria-label="列に並べる"
          aria-pressed={props.leaf.layout === "deck" ? "true" : "false"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => area.applyLayout((state) =>
            setLeafLayout(state, props.leaf.id, props.leaf.layout === "deck" ? "pages" : "deck")
          )}
        >
          <IconDeck size={13} />
        </button>
      </header>
      <div class={"leaf-body"}>
        <Show
          when={props.leaf.panels.length > 0}
          fallback={<LeafEmpty leafId={props.leaf.id} />}
        >
          <PagesTrack
            refs={props.leaf.panels}
            selected={props.leaf.selected}
            onSelect={select}
            scrollHint={scrollHint}
            deck={props.leaf.layout === "deck"}
            colWidth={props.leaf.colWidth}
            onColWidth={(width) =>
              area.applyLayout((state) => setLeafColWidth(state, props.leaf.id, width))}
          />
        </Show>
      </div>
    </section>
  );
}

function LeafEmpty(props: { leafId: string }): JSX.Element {
  const area = useArea();
  return (
    <button
      class={"leaf-empty"}
      aria-label="Panelを開く"
      onClick={(event) => {
        event.stopPropagation();
        // 空区画の「+」はtitleの「+」と同じpickerを開き、足し先をこの区画にする
        area.app.openPicker(area, { region: "leaf", leafId: props.leafId, index: -1 }, event.currentTarget);
      }}
    >
      <IconPlus />
    </button>
  );
}
