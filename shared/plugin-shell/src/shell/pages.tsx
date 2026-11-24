// 全領域で共用するpagesの中身（designs/00005「表示モード」）。
// Panelは画面外にも本来の大きさのまま横に並び、viewportは横scroll
// container＋scroll-snap。追従・momentum・端での跳ね返り・中身scroll
// 優先（scroll chaining）・snap backはすべてネイティブ任せで、
// こちらはscroll位置とselectedの相互同期だけを担う。
// 見えていないPanelは大きさを保ったまま描画だけを止める
// （content-visibility:hidden）。
import { createEffect, createSignal, mapArray, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { PanelRef } from "../layout/model.ts";
import { useArea } from "./controller.tsx";
import { PanelMount } from "./panel-mount.tsx";
import { surfaceAttrs } from "./activity.ts";
import styles from "./pages.module.css";

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

// scroll eventが止まったとみなすまでの時間。scrollend eventのない
// 環境でも同じ仕組みで「scrollの終わり」を検出する。
const SCROLL_SETTLE_MS = 120;
// gesture系入力（wheel/touch）とscroll eventを対応付ける猶予。
// momentum中はscrollが続く間gesture扱いを延長する。
const GESTURE_INPUT_MS = 160;

export function PagesTrack(props: {
  refs: PanelRef[];
  selected: string | null;
  onSelect: (index: number) => void;
}): JSX.Element {
  const area = useArea();
  let viewport!: HTMLDivElement;
  // 描画が必要なpageのindex範囲（見えている区間±1page）。
  const [range, setRange] = createSignal<[number, number]>([0, 0]);
  // gesture由来のscrollとプログラムscroll（scrollIntoView・他scriptの
  // scrollTo）を区別するため、gesture系入力の直近時刻を追う。
  let lastInputAt = 0;
  let settle: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(settle));

  const index = () =>
    Math.max(0, props.refs.findIndex((ref) => ref.instanceId === props.selected));
  const gestureActive = () => Date.now() - lastInputAt < GESTURE_INPUT_MS;

  const syncVisible = () => {
    const w = viewport.clientWidth || 1;
    const f = viewport.scrollLeft / w;
    setRange([Math.floor(f) - 1, Math.ceil(f) + 1]);
  };

  const syncSelected = () => {
    const w = viewport.clientWidth || 1;
    const i = Math.round(viewport.scrollLeft / w);
    if (i !== index() && props.refs[i] !== undefined) props.onSelect(i);
  };

  // selected → scroll位置（tab選択・キー・マウスボタンなど外からの変更）。
  // gesture由来のscrollでselectedがliveに動くときは位置が既に一致して
  // いるのでscrollToは発火しない。
  createEffect(
    () => index(),
    (i) => {
      const left = i * (viewport.clientWidth || 1);
      if (Math.abs(viewport.scrollLeft - left) > 1) {
        viewport.scrollTo({ left, behavior: "smooth" });
      }
    },
  );

  const onScroll = () => {
    syncVisible();
    if (gestureActive()) {
      // momentum中もscrollが続く間はgesture扱いを延長する。
      lastInputAt = Date.now();
      // 利用者のscroll → 止まっているpageをselectedにlive反映（tabが
      // gestureに追従する）。
      syncSelected();
    }
    clearTimeout(settle);
    settle = setTimeout(() => {
      if (gestureActive()) {
        syncSelected();
        return;
      }
      // gesture由来でないscrollは選択位置へ戻す。scroll containerにした
      // 副作用として、Panelの中のscrollIntoViewがviewportまでscroll
      // させてpageをずらすことがある。自分で掛けたscrollToはscrollが
      // 続いている間このtimerが発火しないので巻き込まない。
      const left = index() * (viewport.clientWidth || 1);
      if (Math.abs(viewport.scrollLeft - left) > 1) {
        viewport.scrollTo({ left, behavior: "smooth" });
      }
    }, SCROLL_SETTLE_MS);
  };

  const registerViewport = (el: HTMLDivElement) => {
    viewport = el;
    el.scrollLeft = index() * el.clientWidth;
    syncVisible();
    // resize（splitのresize・drawer開閉・窓のresize）でscrollLeftが
    // page境界からずれるので、選択位置に合わせ直す。
    const observer = new ResizeObserver(() => {
      const left = index() * (el.clientWidth || 1);
      if (Math.abs(el.scrollLeft - left) > 1) el.scrollTo({ left });
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  };

  const visible = (instanceId: string) => {
    const [lo, hi] = range();
    const i = props.refs.findIndex((ref) => ref.instanceId === instanceId);
    return i >= lo && i <= hi;
  };

  return (
    <div
      ref={registerViewport}
      class={styles["pages-viewport"]}
      onScroll={onScroll}
      // gesture判定にだけ使う。scroll自体・中身scroll優先・overscrollの
      // 跳ね返りはすべてネイティブに任せる。
      onWheel={(event) => {
        if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) lastInputAt = Date.now();
      }}
      onTouchMove={() => { lastInputAt = Date.now(); }}
    >
      <div class={styles["pages-track"]}>
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
