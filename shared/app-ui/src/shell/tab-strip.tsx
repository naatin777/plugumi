// 横一列のtab帯。全領域のheaderで共用する。
// tabはclickで選択、×で閉じ、pointerを動かせばdragでregionをまたぐ。
// click/dragの閾値はdrag controllerが持つ（ここでは閾値を実装しない）。
// 帯の上の横スワイプ/横wheelは1回で1つ隣のpageへ（designs/00005
// 「切り替え」）。縦方向のwheelは、tabが溢れてstripがclipしている
// ときだけstrip自体の横scrollに使う（溢れていなければ何もしない）。
import { For, createEffect, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { PanelRef, MoveTarget } from "../layout/model.ts";
import type { PanelInstance } from "../panels/instance.ts";
import { surfaceAttrs, busyAttr } from "./activity.ts";
import { useArea, layoutOps } from "./controller.tsx";
import { IconClose } from "../icons.tsx";
import { stripTest } from "./drag.ts";
import "./tab-strip.css";

export interface TabStripProps {
  refs: PanelRef[];
  selected: string | null;
  // drop先のindexをMoveTargetに変える
  target: (index: number) => MoveTarget;
  onSelect?: (instanceId: string) => void;
  // 帯の上の横スワイプでpageを前後させる（未指定ならwheelは素通し）
  onFlip?: (direction: 1 | -1) => void;
}

export function TabStrip(props: TabStripProps): JSX.Element {
  const area = useArea();
  const ops = layoutOps(area);
  // strip全体がdrop先。登録はrefで行い、class名では探さない。
  let unregister: (() => void) | undefined;
  onCleanup(() => unregister?.());
  let strip!: HTMLElement;
  const register = (node: HTMLElement) => {
    unregister?.();
    strip = node;
    unregister = area.drag.register(area, node, stripTest(props.target));
    node.addEventListener("wheel", onWheel, { passive: false });
    const prevUnregister = unregister;
    unregister = () => {
      node.removeEventListener("wheel", onWheel);
      prevUnregister();
    };
  };

  // 横wheel: 1回のgestureで1pageだけ。deltaXを貯めて閾値で1回flipし、
  // wheelの流れが止まるまで次は出さない。preventDefaultしてブラウザの
  // 戻る/進むや自由scrollを止める。deltaY主体は何もしない。
  const WHEEL_FLIP_PX = 50;
  const WHEEL_IDLE_MS = 200;
  let accum = 0;
  let locked = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => { locked = false; accum = 0; }, WHEEL_IDLE_MS);
  };
  const onWheel = (event: WheelEvent) => {
    if (Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
      // 縦ホイールはstrip自体の横scroll（tabが溢れているときだけ）。
      if (strip.scrollWidth > strip.clientWidth) {
        event.preventDefault();
        strip.scrollLeft += event.deltaY;
      }
      return;
    }
    if (!props.onFlip) return;
    event.preventDefault();
    resetIdle();
    if (locked) return;
    accum += event.deltaX;
    if (Math.abs(accum) >= WHEEL_FLIP_PX) {
      props.onFlip(accum > 0 ? 1 : -1);
      locked = true;
      accum = 0;
    }
  };
  onCleanup(() => clearTimeout(idle));

  // tabが溢れてstripがclipする場合、選択tabは常に見える位置へ寄せる。
  // scrollIntoViewはblock方向に祖先のscroll container（overflow:hiddenの
  // 台など）まで動かして中身をずらすので使わず、strip内の横scrollだけを
  // 動かす。
  createEffect(
    () => props.selected,
    () => {
      const tab = strip?.querySelector<HTMLElement>('[data-part="tab"][data-selected]');
      if (strip === undefined || tab === null) return;
      const stripRect = strip.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      // はみ出した側へ最小限寄せる（inline:"nearest"と同じ動き）。
      const left = strip.scrollLeft + (tabRect.left - stripRect.left);
      const right = left + tabRect.width;
      if (left < strip.scrollLeft) strip.scrollLeft = left;
      else if (right > strip.scrollLeft + strip.clientWidth) {
        strip.scrollLeft = right - strip.clientWidth;
      }
    },
  );

  const press = (ref: PanelRef, instance: PanelInstance, event: PointerEvent) => {
    if (event.button !== 0) return;
    area.drag.start(
      { instanceId: ref.instanceId, title: instance.title(), area },
      event,
      { onClick: () => (props.onSelect ?? ops.select)(ref.instanceId) },
    );
  };

  return (
    <div class={"tab-strip"} ref={register}>
      <For each={props.refs}>
        {(ref) => {
          const inst = () => area.instance(ref);
          return (
            <div
              class={{ "plugumi-tab": true, "plugumi-tab--selected": props.selected === ref.instanceId }}
              data-part="tab"
              data-selected={props.selected === ref.instanceId || undefined}
              role="tab"
              aria-selected={props.selected === ref.instanceId ? "true" : "false"}
              onPointerDown={(event) => press(ref, inst(), event)}
              {...surfaceAttrs(inst().activity(), "header")}
              {...busyAttr(inst().activity())}
            >
              <span class="plugumi-tab-title">{inst().title()}</span>
              <button
                class="plugumi-tab-close"
                data-part="tab-close"
                aria-label="閉じる"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  ops.close(ref.instanceId);
                }}
              >
                <IconClose size={12} />
              </button>
            </div>
          );
        }}
      </For>
    </div>
  );
}
