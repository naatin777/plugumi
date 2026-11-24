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
import styles from "./pages.module.css";

// slideの長さ。pages.module.cssのtransition（160ms）と揃える。
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

// カードの上の横wheelでpageを前後させるgesture。1回のgestureで1page
// だけ: deltaXを貯めて閾値で1回flipし、wheelの流れが止まるまで次は
// 出さない（stripの横wheelと同じidle、閾値はstripより強め — 中身の
// 上なので誤爆を減らす）。
const WHEEL_FLIP_PX = 80;
const WHEEL_IDLE_MS = 200;

// 利用者gestureで横scrollできる要素か（overflow:hiddenはプログラム
// scrollの箱なので利用者scrollの対象に含めない）。scrollの余裕には
// 実質的な下限を設ける — 数pxしか動かない箱にgestureが吸われると
// flipもscrollも起きない「デッドゾーン」になる。
const scrollableX = (el: Element, direction: 1 | -1): boolean => {
  const overflowX = getComputedStyle(el).overflowX;
  if (overflowX !== "auto" && overflowX !== "scroll" && overflowX !== "overlay") return false;
  if (el.scrollWidth - el.clientWidth <= 4) return false;
  return direction > 0
    ? el.scrollLeft < el.scrollWidth - el.clientWidth - 4
    : Math.abs(el.scrollLeft) > 4;
};

// カード要素へまとめて展開するpageナビ用のhandler群。mouseup/auxclickは
// ブラウザの戻る/進む遷移を止めるだけ（flipはmousedownの1回で完結）。
// 横wheelは「中身がその方向へscrollできるなら中身優先、出来なければ
// page flip」。strip上ではstrip自身のhandlerがpreventDefault済みなので
// defaultPreventedで二重flipを避ける。
export const pageNavProps = (flip: (direction: 1 | -1) => void) => {
  let accumX = 0;
  let accumY = 0;
  let locked = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(idle));
  const onWheel = (event: WheelEvent) => {
    if (event.defaultPrevented) return;
    if (Math.abs(event.deltaY) >= Math.abs(event.deltaX)) return;
    const direction: 1 | -1 = event.deltaX > 0 ? 1 : -1;
    // カードの中（Panelのshadow内部まで）にその方向へscrollできる
    // 要素があるならscrollに任せる。無ければpreventDefaultしておく —
    // flipしないsub-thresholdの横スワイプでもブラウザの戻る/進むが
    // 発動するのを防ぐため。
    for (const node of event.composedPath()) {
      if (node === event.currentTarget) break;
      if (node instanceof HTMLElement && scrollableX(node, direction)) return;
    }
    event.preventDefault();
    // flipは「横」のgestureを決めきってから: 累積の横成分が縦の2倍
    // 以上で閾値を超えたときだけ発動する（縦scrollの行きがけの横
    // ドリフトや斜めscrollでは切り替わらない）。
    accumX += event.deltaX;
    accumY += event.deltaY;
    clearTimeout(idle);
    idle = setTimeout(() => { locked = false; accumX = 0; accumY = 0; }, WHEEL_IDLE_MS);
    if (locked) return;
    if (Math.abs(accumX) >= WHEEL_FLIP_PX && Math.abs(accumX) > Math.abs(accumY) * 2) {
      flip(direction);
      locked = true;
      accumX = 0;
      accumY = 0;
    }
  };
  return {
    onMouseDown: pageMouse(flip),
    onMouseUp: (event: MouseEvent) => {
      if (event.button === 3 || event.button === 4) event.preventDefault();
    },
    onAuxClick: (event: MouseEvent) => event.preventDefault(),
    onWheel,
  };
};

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
    <div class={styles["pages-viewport"]}>
      <div
        class={styles["pages-track"]}
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
                class={styles["pages-page"]}
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
