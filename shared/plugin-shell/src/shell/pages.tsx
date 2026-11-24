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
  // に映して隣のpageを「見せるだけ」出し、十分にずれた時点でgesture途中
  // でもonFlipにcommitする。足りないまま途切れれば元の位置へ戻す。
  // 閾値flipと違って指に追従するので、trackのtransitionはdrag中だけ切る。
  const [peek, setPeek] = createSignal<string | null>(null);
  const [dragging, setDragging] = createSignal(false);
  let viewport!: HTMLDivElement;
  let track!: HTMLDivElement;
  // 現在のずれ（負=次のpage側、正=前のpage側）。隣が無い側には0で留める。
  let px = 0;
  // gesture解析用。velocityはpx/ms（符号はpxと同じ向き）のEMA、peakVは
  // gesture中の最大|velocity|、lastDeltaXは直近eventのdeltaX。
  // momentumの減衰が続いている（=指が離れた）とみなしたらcoasting。
  let velocity = 0;
  let peakV = 0;
  let lastDeltaX = 0;
  let lastEventAt = 0;
  let decelCount = 0;
  let coasting = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(idle));

  const index = () =>
    Math.max(0, props.refs.findIndex((ref) => ref.instanceId === props.selected));

  const show = () => {
    setDragging(px !== 0);
    // dragで顔を出す側のpageを描画に載せる（普段はcontent-visibility:hidden）。
    setPeek(px === 0 ? null : (props.refs[px < 0 ? index() + 1 : index() - 1]?.instanceId ?? null));
    track.style.setProperty("--page-drag-px", `${px}px`);
  };

  const release = () => {
    px = 0;
    setDragging(false);
    setPeek(null);
    track.style.setProperty("--page-drag-px", "0px");
  };

  // gestureの決着（commitまたは戻し）をつけたあとは、残りの
  // momentumのdeltaを飲むだけにする。committedDirは決着時の向きで、
  // 逆方向への戻し操作を即座に受け付けるために使う。
  let committedDir: 0 | 1 | -1 = 0;
  let committedAt = 0;

  // gestureの終わり（指が離れてmomentumに入った、または流れが止まった）
  // 時点で、位置と速度からcommitか戻しかを決める。push中は位置が閾値を
  // 越えてもcommitしない — ゆっくりずらしている途中で勝手に切り替わると
  // 「強制的に移動させられた」感じになる。指が離れてからのmomentumの
  // deltaはtrackをもう動かさない。
  const decide = () => {
    const width = viewport.clientWidth || 1;
    const commit =
      Math.abs(px) >= Math.max(96, width * 0.3) ||
      (Math.abs(px) >= 24 && Math.abs(velocity) >= 0.5 && Math.sign(velocity) === Math.sign(px));
    const direction: 1 | -1 = px < 0 ? 1 : -1;
    committedDir = direction;
    committedAt = Date.now();
    release();
    if (commit) props.onFlip(direction);
  };

  const settle = () => {
    if (px !== 0) decide();
    release();
    committedDir = 0;
    coasting = false;
    velocity = 0;
    peakV = 0;
    lastDeltaX = 0;
    lastEventAt = 0;
    decelCount = 0;
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
    // gestureの終わりは「直近のevent間隔」から適応して待つ。固定値だと
    // ゆっくりなgesture（event自体がまばら）の途中の小休止を終了と
    // 誤判定してtrackが跳ねる（wheel-gesturesのwillEndと同じ考え方）。
    const now = Date.now();
    const gapMs = lastEventAt === 0 ? 0 : now - lastEventAt;
    clearTimeout(idle);
    idle = setTimeout(settle, Math.min(800, Math.max(300, gapMs * 1.6)));

    if (committedDir !== 0) {
      // momentumは減衰しかしない。減衰中（coasting）にdeltaが急増した
      // ら指が戻った新しいpushとして再武装する。逆方向と抑止の上限は
      // 常に受け付ける。
      const surge = Math.abs(event.deltaX) > Math.max(10, Math.abs(lastDeltaX) * 1.8);
      const rearmed =
        Math.sign(event.deltaX) === -committedDir ||
        (coasting && surge) ||
        now - committedAt > 600;
      // 抑止中も勢いの減衰は追いかける。急増判定はこのlastDeltaXが基準。
      if (Math.abs(event.deltaX) < Math.abs(lastDeltaX) * 0.7) coasting = true;
      lastDeltaX = event.deltaX;
      lastEventAt = now;
      if (!rearmed) return;
      committedDir = 0;
      coasting = false;
      px = 0;
      velocity = 0;
      peakV = 0;
      decelCount = 0;
    }

    const prevDelta = lastDeltaX;
    // 速度（EMA）。push終了時のcommit判定（flickは移動量が小さくても
    // 速度で送る）と、減衰検出が有効になる速度だったかの判定に使う。
    if (gapMs > 0) {
      velocity = velocity * 0.7 + (-event.deltaX / Math.max(4, gapMs)) * 0.3;
      peakV = Math.max(peakV, Math.abs(velocity));
    }
    lastDeltaX = event.deltaX;
    lastEventAt = now;
    px -= event.deltaX;
    const width = viewport.clientWidth || 1;
    const at = index();
    px = Math.min(at > 0 ? width : 0, Math.max(at + 1 < props.refs.length ? -width : 0, px));
    show();
    // pushの終わり = deltaの減衰が続いたとき。ゆっくりなdragはdeltaが
    // 小さく揺らぐので、一度速く動いたgestureにだけこの判定をかける。
    if (peakV >= 0.4 && Math.abs(event.deltaX) < Math.abs(prevDelta) * 0.7) decelCount += 1;
    else decelCount = 0;
    if (decelCount >= 2) decide();
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
