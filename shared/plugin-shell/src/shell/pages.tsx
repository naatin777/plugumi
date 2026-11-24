// 全領域で共用するpagesの中身（designs/00005「表示モード」）。
// Panelは画面外にも本来の大きさのまま横に並び、viewportは横scroll
// container＋scroll-snap。追従・momentum・端での跳ね返り・中身scroll
// 優先（scroll chaining）・snap backはすべてネイティブ任せ。
// pagesはscroll位置とselectedの相互同期を担う。deckではscroll位置は
// 一切制御しない（snapも戻しも無し）が、gestureで流している間は
// 中央に掛かっている列をselectedに反映し、tabが「読んでいる場所」を指す。
// 見えていないPanelは大きさを保ったまま描画だけを止める
// （content-visibility:hidden）。
import { createEffect, createSignal, mapArray, onCleanup, onSettled, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { PanelRef } from "../layout/model.ts";
import { useArea } from "./controller.tsx";
import { PanelMount } from "./panel-mount.tsx";
import { Resizer } from "./resizer.tsx";
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
  // deck: 全幅pageではなく固定幅の列を横に並べて流し見する
  // （designs/00005「表示モード」）。
  deck?: boolean;
  // deckの列幅（px）。未指定はCSSの既定値。onColWidthを渡すと列の境目を
  // 掴んで全列共通の幅を変えられる。
  colWidth?: number;
  onColWidth?: (width: number) => void;
}): JSX.Element {
  const area = useArea();
  let viewport!: HTMLDivElement;
  // 描画が必要なpageのindex範囲（見えている区間±1page）。
  const [range, setRange] = createSignal<[number, number]>([0, 0]);
  // gesture由来のscrollとプログラムscroll（scrollIntoView・他scriptの
  // scrollTo）を区別するため、gesture系入力の直近時刻を追う。
  let lastInputAt = 0;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let observer: ResizeObserver | undefined;
  onCleanup(() => {
    clearTimeout(settle);
    observer?.disconnect();
  });

  const index = () =>
    Math.max(0, props.refs.findIndex((ref) => ref.instanceId === props.selected));
  const gestureActive = () => Date.now() - lastInputAt < GESTURE_INPUT_MS;

  // pageの列幅と配置間隔を実測する。pagesは列幅=viewport幅でpitchも
  // 同じになるので、どちらのlayoutでも同じ式が使える。
  const metrics = () => {
    const track = viewport.firstElementChild;
    const first = track?.children[0];
    const second = track?.children[1];
    const colW = first?.getBoundingClientRect().width || viewport.clientWidth || 1;
    const pitch = first !== undefined && second !== undefined
      ? second.getBoundingClientRect().left - first.getBoundingClientRect().left
      : colW;
    return { colW, pitch: pitch || colW };
  };
  const pageLeft = (i: number) => i * metrics().pitch;

  const syncVisible = () => {
    const { pitch } = metrics();
    const w = viewport.clientWidth || 1;
    setRange([
      Math.floor(viewport.scrollLeft / pitch) - 1,
      Math.ceil((viewport.scrollLeft + w) / pitch),
    ]);
  };

  const syncSelected = () => {
    // deckは「viewportの中央に掛かっている列」を読んでいる場所とみなす。
    const { pitch } = metrics();
    const i = props.deck
      ? Math.min(props.refs.length - 1,
          Math.floor((viewport.scrollLeft + viewport.clientWidth / 2) / pitch))
      : Math.round(viewport.scrollLeft / pitch);
    if (i !== index() && props.refs[i] !== undefined) props.onSelect(i);
  };

  // selected → scroll位置（tab選択・キー・マウスボタンなど外からの変更）。
  // pagesは選択pageがviewportに収まるようscrollする。gesture由来の
  // scrollでselectedがliveに動くときは位置が既に一致しているので
  // scrollToは発火しない。
  // deckは選択した列が見えていなければ最小限寄せるだけで、見えていれば
  // scroll位置に一切触らない（scroll位置は利用者のもの）。
  createEffect(
    () => index(),
    (i) => {
      if (props.deck) {
        // gesture scrollの追従で選択が動いただけなら寄せない — 列の
        // 途中で止めたいのに選択した列へscrollが引っ張られる。
        if (gestureActive()) return;
        const { colW, pitch } = metrics();
        const left = i * pitch;
        const end = viewport.scrollLeft + viewport.clientWidth;
        const target = left < viewport.scrollLeft ? left
          : left + colW > end ? left + colW - viewport.clientWidth
          : undefined;
        if (target !== undefined) {
          viewport.scrollTo({ left: target, behavior: "smooth" });
        }
        return;
      }
      const left = pageLeft(i);
      if (Math.abs(viewport.scrollLeft - left) > 1) {
        viewport.scrollTo({ left, behavior: "smooth" });
      }
    },
  );

  const onScroll = () => {
    syncVisible();
    // deckはscroll位置に一切触らない（settle補正も無し）。gestureで
    // 流している間だけ、一番見えている列をtabに反映する。tab押下で
    // 掛けた寄せscrollはgesture扱いにならないので追従は発火しない
    // （追従→別列を寄せる→追従、の往復を避けるため）。
    if (props.deck) {
      if (gestureActive()) {
        lastInputAt = Date.now();
        syncSelected();
      }
      return;
    }
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
      const left = pageLeft(index());
      if (Math.abs(viewport.scrollLeft - left) > 1) {
        viewport.scrollTo({ left, behavior: "smooth" });
      }
    }, SCROLL_SETTLE_MS);
  };

  const registerViewport = (el: HTMLDivElement) => {
    viewport = el;
  };

  // 初期位置とobserverはsettle後に張る — ref発火の時点ではpageの
  // 子要素がまだ無く、deckのpitch計測ができないため。
  onSettled(() => {
    // 初期位置・resize時の読みは追跡不要の現在値（untrackで明示）。
    viewport.scrollLeft = pageLeft(untrack(index));
    syncVisible();
    // resize（splitのresize・drawer開閉・窓のresize）でscrollLeftが
    // page境界からずれるので、選択位置に合わせ直す。deckの列幅は
    // 窓に依らないので合わせ直す必要がない。
    observer = new ResizeObserver(() => {
      if (props.deck) return;
      const left = pageLeft(untrack(index));
      if (Math.abs(viewport.scrollLeft - left) > 1) viewport.scrollTo({ left });
    });
    observer.observe(viewport);
  });

  const visible = (instanceId: string) => {
    const [lo, hi] = range();
    const i = props.refs.findIndex((ref) => ref.instanceId === instanceId);
    return i >= lo && i <= hi;
  };

  return (
    <div
      ref={registerViewport}
      class={styles["pages-viewport"]}
      data-layout={props.deck ? "deck" : "pages"}
      style={props.deck && props.colWidth !== undefined
        ? { "--deck-col-w": `${props.colWidth}px` }
        : undefined}
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
          (ref, i) => {
            const instanceId = ref.instanceId;
            const instance = area.instance(ref);
            return (
              <div
                class={styles["pages-page"]}
                data-part="pages-page"
                style={{
                  "content-visibility": visible(instanceId) ? "visible" : "hidden",
                }}
                {...surfaceAttrs(instance.activity(), "content")}
              >
                {/* 列の境目のresizer（deck時のみ、全列共通の幅を変える）。 */}
                {props.deck && props.onColWidth !== undefined && i() > 0 ? (
                  <Resizer
                    axis="x"
                    direction={1}
                    value={() => metrics().colW}
                    apply={props.onColWidth}
                  />
                ) : null}
                <PanelMount instance={instance} />
              </div>
            );
          },
        )()}
      </div>
    </div>
  );
}
