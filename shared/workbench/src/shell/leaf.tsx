// centerの区画。「tab帯（header）＋中身」の1枚のカード（designs/00005
// 「tab帯はカードのheader」）。中身は全領域で共用のpages track。
import { Show, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { Leaf } from "../layout/model.ts";
import { useArea } from "./controller.tsx";
import { TabStrip } from "./tab-strip.tsx";
import { PagesTrack, flipPage, pageNavProps } from "./pages.tsx";
import { leafBodyTest } from "./drag.ts";
import { focusLeaf, selectPanel, setLeafLayout, setLeafColWidth } from "../layout/model.ts";
import { dividerAttr, surfaceAttrs, busyAttr } from "./activity.ts";
import { IconPlus, IconDeck } from "../icons.tsx";
import styles from "./leaf.module.css";
import stripStyles from "./tab-strip.module.css";

export function LeafView(props: { leaf: Leaf }): JSX.Element {
  const area = useArea();
  const focused = () => area.layout().center.focusedLeaf === props.leaf.id;
  let unregister: (() => void) | undefined;
  onCleanup(() => unregister?.());
  const registerBody = (node: HTMLElement) => {
    unregister?.();
    // props.leafはlive getter（loadで差し替わる）なのでidはdrop時に読む
    unregister = area.drag.register(area, node, leafBodyTest(() => props.leaf.id));
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
  const flip = (direction: 1 | -1) => {
    const id = flipPage(props.leaf.panels, props.leaf.selected, direction);
    if (id) area.applyLayout((state) => selectPanel(state, id));
  };
  const select = (index: number) => {
    const ref = props.leaf.panels[index];
    if (ref) area.applyLayout((state) => selectPanel(state, ref.instanceId));
  };
  return (
    <section
      class={{ [styles["leaf"]]: true, [styles["focused"]]: focused() }}
      data-part="leaf"
      onPointerDown={markFocus}
      {...pageNavProps(flip)}
      {...surfaceAttrs(selectedInstance()?.activity(), "border")}
      {...busyAttr(selectedInstance()?.activity())}
    >
      <header class={stripStyles["leaf-strip"]} data-part="leaf-strip" {...dividerAttr(selectedInstance()?.activity())}>
        <TabStrip
          refs={props.leaf.panels}
          selected={props.leaf.selected}
          target={(index) => ({ region: "leaf", leafId: props.leaf.id, index })}
          onFlip={flip}
        />
        {/* 列への展開。deckでは中身を固定幅の列にして横scrollで流し見する。 */}
        <button
          class={`${stripStyles["strip-deck"]} ${props.leaf.layout === "deck" ? stripStyles["on"] : ""}`}
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
      <div class={styles["leaf-body"]} ref={registerBody}>
        <Show
          when={props.leaf.panels.length > 0}
          fallback={<LeafEmpty leafId={props.leaf.id} />}
        >
          <PagesTrack
            refs={props.leaf.panels}
            selected={props.leaf.selected}
            onSelect={select}
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
      class={styles["leaf-empty"]}
      aria-label="Panelを開く"
      onClick={(event) => {
        event.stopPropagation();
        // 空区画の「+」はtitleの「+」と同じpickerを開き、足し先をこの区画にする
        area.shell.openPicker(area, { region: "leaf", leafId: props.leafId, index: -1 }, event.currentTarget);
      }}
    >
      <IconPlus />
    </button>
  );
}
