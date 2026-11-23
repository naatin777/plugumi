// 全領域で共用するpagesの中身（designs/00005「表示モード」）。
// Panelは画面外にも本来の大きさのまま横に並び、切替えはtrackの平行
// 移動（約160ms）で見せる。利用者の自由な横scrollはしない
// （containerはoverflow:hidden）。見えていないPanelは大きさを保った
// まま描画だけを止める（content-visibility:hidden）。
// slideの途中は行き・帰りの両pageを描画する必要があるので、
// hiddenの付与はslideが終わってから行う。
import { createEffect, createSignal, mapArray, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { PanelRef } from "../layout/model.ts";
import { useArea } from "./controller.tsx";
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

// カード要素へまとめて展開するpageナビ用のhandler群。mouseup/auxclickは
// ブラウザの戻る/進む遷移を止めるだけ（flipはmousedownの1回で完結）。
export const pageNavProps = (flip: (direction: 1 | -1) => void) => ({
  onMouseDown: pageMouse(flip),
  onMouseUp: (event: MouseEvent) => {
    if (event.button === 3 || event.button === 4) event.preventDefault();
  },
  onAuxClick: (event: MouseEvent) => event.preventDefault(),
});

export function PagesTrack(props: {
  refs: PanelRef[];
  selected: string | null;
}): JSX.Element {
  const area = useArea();
  // slide中に描画するもう1枚（行きのpage）。selectedはpropsから、
  // 帰り側は遷移元としてだけ保持する。
  const [outgoing, setOutgoing] = createSignal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // setup中にprops.selectedを読むとuntracked read警告になるので遅延初期化。
  let previous: string | null | undefined;

  createEffect(
    () => props.selected,
    (selected) => {
      if (previous === undefined) {
        previous = selected;
        return;
      }
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
        {/* <For each={store配列}>はeachの評価がuntracked setupで走り
            警告になるのでmapArrayを直接使う（mapper内は各itemがtracked）。 */}
        {mapArray(
          () => props.refs,
          (ref) => {
            const instanceId = ref.instanceId;
            const instance = area.instance(ref);
            return (
              <div
                class="pages-page"
                style={{
                  "content-visibility": visible(instanceId) ? "visible" : "hidden",
                }}
                {...surfaceAttrs(instance.activity(), "content")}
              >
                <PanelMount instance={instance} />
              </div>
            );
          },
        )()}
      </div>
    </div>
  );
}
