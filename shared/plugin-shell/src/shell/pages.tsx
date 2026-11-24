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

// カード要素へまとめて展開するpageナビ用のhandler群。mouseup/auxclickは
// ブラウザの戻る/進む遷移を止めるだけ（flipはmousedownの1回で完結）。
export const pageNavProps = (flip: (direction: 1 | -1) => void) => ({
  onMouseDown: pageMouse(flip),
  onMouseUp: (event: MouseEvent) => {
    if (event.button === 3 || event.button === 4) event.preventDefault();
  },
  onAuxClick: (event: MouseEvent) => event.preventDefault(),
});

// wheel gestureが途切れたとみなすまでのidle時間。
const WHEEL_IDLE_MS = 200;

// 利用者gestureで横scrollできる要素か（overflow:hiddenはプログラム
// scrollの箱なので利用者scrollの対象に含めない）。scrollの余裕には
// 実質的な下限を設ける — 数pxしか動かない箱にgestureが吸われると
// dragもscrollも起きない「デッドゾーン」になる。
const scrollableX = (el: Element, direction: 1 | -1): boolean => {
  const overflowX = getComputedStyle(el).overflowX;
  if (overflowX !== "auto" && overflowX !== "scroll" && overflowX !== "overlay") return false;
  if (el.scrollWidth - el.clientWidth <= 4) return false;
  return direction > 0
    ? el.scrollLeft < el.scrollWidth - el.clientWidth - 4
    : Math.abs(el.scrollLeft) > 4;
};

export function PagesTrack(props: {
  refs: PanelRef[];
  selected: string | null;
  onFlip: (direction: 1 | -1) => void;
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

  // 横wheel gestureの追従drag。deltaXの累積をtrackのずれ（--page-drag-px）
  // に映して隣のpageを「見せるだけ」出し、gestureが途切れた時点で十分に
  // 動いていればonFlipでcommit、足りなければ元の位置へ戻す。閾値flipと
  // 違って指に追従するので、trackのtransitionはdrag中だけ切る。
  const [peek, setPeek] = createSignal<string | null>(null);
  const [dragging, setDragging] = createSignal(false);
  let viewport!: HTMLDivElement;
  let track!: HTMLDivElement;
  let accumX = 0;
  let accumY = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(idle));

  const index = () =>
    Math.max(0, props.refs.findIndex((ref) => ref.instanceId === props.selected));

  // accumXをtrackのずれpxに変換する。隣のpageが無い側には動かせない。
  const dragPx = () => {
    const width = viewport.clientWidth || 1;
    const at = index();
    const lower = at + 1 < props.refs.length ? -width : 0;
    const upper = at > 0 ? width : 0;
    return Math.min(upper, Math.max(lower, -accumX));
  };

  // commitした直後は同じgestureの勢い（momentum）で連続してpageを
  // 送らないよう抑止する。ただし抑止は勢いが落ちるまでに限定する —
  // wheelが完全に途切れるまで待つと、休まず続けてスワイプしたとき
  // momentumと次のスワイプが1本のストリームになり、全部飲み込まれて
  // 「連続でスワイプできない」になる。
  let committedDir: 0 | 1 | -1 = 0;
  let committedAt = 0;

  const release = () => {
    setDragging(false);
    setPeek(null);
    track.style.setProperty("--page-drag-px", "0px");
  };

  // 閾値を越えた時点（gesture途中）でcommitする。wheelの流れが途切れる
  // まで待つとmomentum分だけ遅れて、tabの反映が遅く感じられる。
  const finish = (direction: 1 | -1) => {
    committedDir = direction;
    committedAt = Date.now();
    release();
    props.onFlip(direction);
  };

  const settle = () => {
    release();
    accumX = 0;
    accumY = 0;
    committedDir = 0;
  };

  const onWheel = (event: WheelEvent) => {
    if (event.defaultPrevented) return;
    if (Math.abs(event.deltaY) >= Math.abs(event.deltaX)) return;
    const direction: 1 | -1 = event.deltaX > 0 ? 1 : -1;
    // 中身（Panelのshadow内部まで）がその方向へscrollできるなら
    // scrollに任せる。無ければpreventDefaultしておく — commitしない
    // sub-thresholdの横スワイプでもブラウザの戻る/進むが発動するのを防ぐ。
    for (const node of event.composedPath()) {
      if (node === viewport) break;
      if (node instanceof HTMLElement && scrollableX(node, direction)) return;
    }
    event.preventDefault();
    clearTimeout(idle);
    idle = setTimeout(settle, WHEEL_IDLE_MS);
    if (committedDir !== 0) {
      // 勢いが落ちた（deltaが小さい）・逆方向へ戻し始めた・抑止の上限を
      // 越えた、のどれかで再武装する。
      const rearmed =
        Math.sign(event.deltaX) === -committedDir ||
        Math.abs(event.deltaX) < 8 ||
        Date.now() - committedAt > 400;
      if (!rearmed) return;
      committedDir = 0;
      accumX = 0;
      accumY = 0;
    }
    accumX += event.deltaX;
    accumY += event.deltaY;
    const px = dragPx();
    // 隣が無い側にclampされた分は捨てる。そのまま貯めると逆向きに
    // 戻し始めても溜まった分を返すまでtrackが動かない。
    accumX = -px;
    setDragging(px !== 0);
    // dragで顔を出す側のpageを描画に載せる（普段はcontent-visibility:hidden）。
    setPeek(px === 0 ? null : (props.refs[px < 0 ? index() + 1 : index() - 1]?.instanceId ?? null));
    track.style.setProperty("--page-drag-px", `${px}px`);
    const width = viewport.clientWidth || 1;
    if (Math.abs(px) >= Math.max(80, width * 0.25) && Math.abs(accumX) > Math.abs(accumY) * 2) {
      finish(px < 0 ? 1 : -1);
    }
  };

  // slide中はfrom/toの両方を描画、それ以外はselectedだけ描画する。
  // 追従drag中はpeek（ずれて見えている隣のpage）も描画に載せる。
  const visible = (instanceId: string) =>
    instanceId === props.selected || instanceId === outgoing() || instanceId === peek();

  return (
    <div ref={viewport} class={styles["pages-viewport"]} onWheel={onWheel}>
      <div
        ref={track}
        class={styles["pages-track"]}
        data-wheel-drag={dragging() ? "" : undefined}
        style={{
          "--page-index": String(index()),
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
