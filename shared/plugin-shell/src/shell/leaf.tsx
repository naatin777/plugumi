// centerの区画。「tab帯（header）＋中身」の1枚のカード（designs/00005
// 「tab帯はカードのheader」）。中身は全領域で共用のpages track。
import { Show, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { Leaf } from "../layout/model.ts";
import { useShell } from "./controller.tsx";
import type { Edges } from "./center.tsx";
import { TabStrip } from "./tab-strip.tsx";
import { PagesTrack, flipPage, pageNavProps } from "./pages.tsx";
import { leafBodyTest } from "./drag.ts";
import { focusLeaf, selectPanel } from "../layout/model.ts";
import { dividerAttr, surfaceAttrs, busyAttr } from "./activity.ts";
import { IconPlus } from "../icons.tsx";

export function LeafView(props: { leaf: Leaf; edges: Edges }): JSX.Element {
  const shell = useShell();
  const focused = () => shell.layout().center.focusedLeaf === props.leaf.id;
  let unregister: (() => void) | undefined;
  onCleanup(() => unregister?.());
  const registerBody = (node: HTMLElement) => {
    unregister?.();
    // props.leafはlive getter（loadで差し替わる）なのでidはdrop時に読む
    unregister = shell.drag.register(node, leafBodyTest(() => props.leaf.id));
  };
  const markFocus = () => {
    // leafのどこを触っても、「+」の足し先・前後キーの対象はこの区画になる
    if (!focused()) shell.applyLayout((state) => focusLeaf(state, props.leaf.id));
  };
  // カードの枠・divider面は選択中のPanelのactivityを写す。
  const selectedInstance = () => {
    const ref = props.leaf.panels.find((entry) => entry.instanceId === props.leaf.selected);
    return ref ? shell.instance(ref) : undefined;
  };
  const flip = (direction: 1 | -1) => {
    const id = flipPage(props.leaf.panels, props.leaf.selected, direction);
    if (id) shell.applyLayout((state) => selectPanel(state, id));
  };
  return (
    <section
      class={{ leaf: true, focused: focused() }}
      style={{
        // splitの内側の辺は直角にし、外縁の角だけを丸める
        "border-top-left-radius": props.edges.top && props.edges.left ? "var(--plugumi-radii-lg)" : "0",
        "border-top-right-radius": props.edges.top && props.edges.right ? "var(--plugumi-radii-lg)" : "0",
        "border-bottom-right-radius": props.edges.bottom && props.edges.right ? "var(--plugumi-radii-lg)" : "0",
        "border-bottom-left-radius": props.edges.bottom && props.edges.left ? "var(--plugumi-radii-lg)" : "0",
      }}
      onPointerDown={markFocus}
      {...pageNavProps(flip)}
      {...surfaceAttrs(selectedInstance()?.activity(), "border")}
      {...busyAttr(selectedInstance()?.activity())}
    >
      <header class="leaf-strip" {...dividerAttr(selectedInstance()?.activity())}>
        <TabStrip
          refs={props.leaf.panels}
          selected={props.leaf.selected}
          target={(index) => ({ region: "leaf", leafId: props.leaf.id, index })}
          onFlip={flip}
        />
      </header>
      <div class="leaf-body" ref={registerBody}>
        <Show
          when={props.leaf.panels.length > 0}
          fallback={<LeafEmpty leafId={props.leaf.id} />}
        >
          <PagesTrack refs={props.leaf.panels} selected={props.leaf.selected} />
        </Show>
      </div>
    </section>
  );
}

function LeafEmpty(props: { leafId: string }): JSX.Element {
  const shell = useShell();
  return (
    <button
      class="leaf-empty"
      aria-label="Panelを開く"
      onClick={(event) => {
        event.stopPropagation();
        // 空区画の「+」はtitleの「+」と同じpickerを開き、足し先をこの区画にする
        shell.openPicker({ region: "leaf", leafId: props.leafId, index: -1 });
      }}
    >
      <IconPlus />
    </button>
  );
}
