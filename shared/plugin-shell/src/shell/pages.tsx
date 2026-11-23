// 全領域で共用するpagesの中身（designs/00005「表示モード」）。
// Panelは画面外にも本来の大きさのまま横に並び、切替えはtrackの平行
// 移動（約160ms）で見せる。利用者の自由な横scrollはしない
// （containerはoverflow:hidden）。見えていないPanelは大きさを保った
// まま描画だけを止める（content-visibility:hidden）。
// slideの途中は行き・帰りの両pageを描画する必要があるので、
// hiddenの付与はslideが終わってから行う。
import { For, createEffect, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { PanelRef } from "../layout/model.ts";
import { useShell } from "./controller.tsx";
import { PanelMount } from "./panel-mount.tsx";
import { surfaceAttrs } from "./activity.ts";

// slideの長さ。pages.cssの--pages-slideと揃える。
const SLIDE_MS = 160;

// 選択中から±1へ。端で止める（回らない）。移動したかを返す。
export const flipPage = (
  refs: PanelRef[], selected: string | null, direction: 1 | -1,
): string | null => {
  if (refs.length < 2) return null;
  const index = refs.findIndex((ref) => ref.instanceId === selected);
  const next = refs[Math.min(refs.length - 1, Math.max(0, index + direction))];
  return next && next.instanceId !== selected ? next.instanceId : null;
};

// カードの上でのマウス戻る/進むボタン（button 3/4）。historyを動かさず
// pageを前後させる。button3=戻る=前、button4=進む=次。
export const pageMouse = (flip: (direction: 1 | -1) => void) =>
  (event: MouseEvent): void => {
    if (event.button === 3 || event.button === 4) {
      event.preventDefault();
      flip(event.button === 3 ? -1 : 1);
    }
  };

export function PagesTrack(props: {
  refs: PanelRef[];
  selected: string | null;
}): JSX.Element {
  const shell = useShell();
  // slide中に描画するもう1枚（行きのpage）。selectedはpropsから、
  // 帰り側は遷移元としてだけ保持する。
  const [outgoing, setOutgoing] = createSignal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous = props.selected;

  createEffect(
    () => props.selected,
    (selected) => {
      if (selected === previous) return;
      clearTimeout(timer);
      // 遷移元をslideの間だけ描画に残す。
      setOutgoing(previous);
      previous = selected;
      timer = setTimeout(() => setOutgoing(null), SLIDE_MS);
    },
  );
  onCleanup(() => clearTimeout(timer));

  // slide中はfrom/toの両方を描画、それ以外はselectedだけ描画する。
  const visible = (instanceId: string) =>
    instanceId === props.selected || instanceId === outgoing();

  return (
    <div class="pages-viewport">
      <div
        class="pages-track"
        style={{
          "--page-index": String(
            Math.max(0, props.refs.findIndex((ref) => ref.instanceId === props.selected)),
          ),
        }}
      >
        <For each={props.refs}>
          {(ref) => (
            <div
              class="pages-page"
              style={{
                "content-visibility": visible(ref.instanceId) ? "visible" : "hidden",
              }}
              {...surfaceAttrs(shell.instance(ref).activity(), "content")}
            >
              <PanelMount instance={shell.instance(ref)} />
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
