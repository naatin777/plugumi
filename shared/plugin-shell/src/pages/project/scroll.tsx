import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { ChevronLeft, ChevronRight } from "lucide-solid";

// タブ帯のスクロール。スクロールバーは出さず、溢れたときだけ両端のボタンを
// 表示してscrollByで送る。中身は子要素として受け取る。
export interface ScrollApi {
  scrollBy: (amount: number) => void;
  overflowing: () => boolean;
}

export function TabScroller(props: {
  children: JSX.Element;
  columns?: boolean;
  // external=true: ‹›は描画せず、api経由で外部（タブ行のボタン）から操作する。
  external?: boolean;
  api?: (api: ScrollApi) => void;
}) {
  let scrollEl: HTMLDivElement | undefined;
  let innerEl: HTMLDivElement | undefined;
  const [overflowing, setOverflowing] = createSignal(false);
  const checkOverflow = () => {
    setOverflowing(!!scrollEl && scrollEl.scrollWidth > scrollEl.clientWidth + 1);
  };
  const observer = new ResizeObserver(checkOverflow);
  onMount(() => {
    // scrollElは幅変化、innerElは内容量変化を検知するため両方監視する。
    if (scrollEl) observer.observe(scrollEl);
    if (innerEl) observer.observe(innerEl);
    checkOverflow();
  });
  onCleanup(() => observer.disconnect());
  const scrollBy = (amount: number) =>
    scrollEl?.scrollBy({ left: amount, behavior: "smooth" });
  props.api?.({ scrollBy, overflowing });
  return (
    <>
      <Show when={overflowing() && !props.external}>
        <button class="dock-scroll" onClick={() => scrollBy(-120)}>
          <ChevronLeft size={12} />
        </button>
      </Show>
      <div
        class="dock-tabs-scroll"
        classList={{ "ws-cols": props.columns }}
        ref={(el) => (scrollEl = el)}
        onWheel={(e) => {
          const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
          if (!overflowing() || delta === 0) return;
          e.preventDefault();
          scrollEl?.scrollBy({ left: delta });
        }}
      >
        <div class="dock-tabs-inner" classList={{ "ws-cols": props.columns }} ref={(el) => (innerEl = el)}>
          {props.children}
        </div>
      </div>
      <Show when={overflowing() && !props.external}>
        <button class="dock-scroll" onClick={() => scrollBy(120)}>
          <ChevronRight size={12} />
        </button>
      </Show>
    </>
  );
}

