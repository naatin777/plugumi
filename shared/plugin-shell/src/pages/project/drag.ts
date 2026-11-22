// WorkspaceのタブDnD（pointerベース。HTML5 DnDはブラウザごとに癖があるため）。
// hitは.ws-area単位: タブ帯上=leaf内挿入、カードedge=split。
// scroll/pages表示のleafではitem上のdrop=挿入（分割しない）、上下帯のみsplit。
import { createSignal, type Accessor } from "solid-js";
import type { PanelRef } from "../../host";
import type { DropEdge } from "./model";

type DropHit =
  | { kind: "into"; areaId: string; index: number }
  | { kind: "split"; areaId: string; edge: DropEdge }
  | { kind: "dock"; dock: "left" | "right" | "bottom" | "shelf"; index: number };

export interface TabDrag {
  ghost: Accessor<{ x: number; y: number; title: string } | undefined>;
  pressTab: (ref: PanelRef, event: PointerEvent) => void;
  // drag後のpointerupが別タブ上で発火するとclickで選択が上書きされる。
  // dragが成立した直後のclickは無効化する。
  suppressSelect: () => boolean;
}

export function createTabDrag(deps: {
  panelTitle: (ref: PanelRef) => string;
  activeKey: () => string;
  moveWsPanel: (target: string, ref: PanelRef, areaId: string, index: number) => void;
  splitWsPanel: (target: string, ref: PanelRef, areaId: string, edge: DropEdge) => void;
  movePanelToDock: (target: string, ref: PanelRef, dock: "left" | "right" | "bottom" | "shelf", index: number) => void;
}): TabDrag {
  const [ghost, setGhost] = createSignal<{ x: number; y: number; title: string }>();

  let dragRef: PanelRef | null = null;
  let pending: { ref: PanelRef; x: number; y: number } | null = null;
  let marked: HTMLElement | null = null;
  let suppressSelectUntil = 0;

  const clearMarked = () => {
    marked?.classList.remove(
      "drop-into", "drop-before", "drop-after",
      "drop-top", "drop-bottom", "drop-left", "drop-right",
    );
    marked = null;
  };

  // 分割しても各葉がタブ帯+カードを維持できる最小の軸サイズ（これの2倍未満はsplit不可）。
  const MIN_SPLIT_AXIS = 140;

  const hitTest = (ev: PointerEvent): DropHit | null => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    clearMarked();
    const areaEl = el?.closest<HTMLElement>(".ws-area");
    if (!areaEl?.dataset.areaId) {
      // ws leaf以外: dock(他region)へのdrop。タブ帯上ならindex推定、それ以外は末尾。
      const dockEl = el?.closest<HTMLElement>(".dock");
      const dock = dockEl
        && (["left", "right", "bottom", "shelf"] as const).find((k) =>
          dockEl.classList.contains(`dock-${k}`)
        );
      if (!dockEl || !dock) return null;
      let index = Number.MAX_SAFE_INTEGER;
      const tabsEl = el?.closest<HTMLElement>(".dock-tabs");
      if (tabsEl && dockEl.contains(tabsEl)) {
        tabsEl.classList.add("drop-into");
        marked = tabsEl;
        const tabs = tabsEl.querySelectorAll(".shell-tab");
        index = tabs.length;
        for (let i = 0; i < tabs.length; i++) {
          const rect = tabs[i].getBoundingClientRect();
          if (ev.clientX < rect.left + rect.width / 2) {
            index = i;
            break;
          }
        }
      } else {
        dockEl.classList.add("drop-into");
        marked = dockEl;
        // shelfはtab帯を持たないので、sectionの縦中央から挿入indexを推定する。
        if (dock === "shelf") {
          const sections = [...dockEl.querySelectorAll<HTMLElement>(".shelf-section")];
          index = sections.length;
          for (let i = 0; i < sections.length; i++) {
            const rect = sections[i].getBoundingClientRect();
            if (ev.clientY < rect.top + rect.height / 2) {
              index = i;
              break;
            }
          }
        }
      }
      return { kind: "dock", dock, index };
    }
    // leafの表示形態でhit判定を分ける（tabs=edge帯split / scroll=左右挿入+上下split）。
    const display = (areaEl.dataset.display ?? "tabs") as "tabs" | "scroll" | "pages";
    const areaId = areaEl.dataset.areaId;
    // タブ帯上: そのAreaのタブ位置へ挿入。
    const tabsEl = el?.closest<HTMLElement>(".dock-tabs");
    if (tabsEl && areaEl.contains(tabsEl)) {
      tabsEl.classList.add("drop-into");
      marked = tabsEl;
      const tabs = tabsEl.querySelectorAll(".shell-tab");
      let index = tabs.length;
      for (let i = 0; i < tabs.length; i++) {
        const rect = tabs[i].getBoundingClientRect();
        if (ev.clientX < rect.left + rect.width / 2) {
          index = i;
          break;
        }
      }
      return { kind: "into", areaId, index };
    }
    // scroll/pages表示: item/page上のdrop=挿入。上下帯のみsplit（マーカーはcardに載せる）。
    if (display === "scroll" || display === "pages") {
      const pages = el?.closest<HTMLElement>(".ws-pages, .ws-items");
      // pages外（gapなど）はleaf末尾への挿入にフォールバック。
      if (!pages || !areaEl.contains(pages)) {
        return { kind: "into", areaId, index: Number.MAX_SAFE_INTEGER };
      }
      const prect = pages.getBoundingClientRect();
      const relY = (ev.clientY - prect.top) / prect.height;
      const card = areaEl.querySelector<HTMLElement>(".dock-card");
      // 分割後の葉がタブ帯+カードを載せられる高さを割るならsplitしない。
      if (card && prect.height >= MIN_SPLIT_AXIS * 2 && relY < 0.25) {
        card.classList.add("drop-top");
        marked = card;
        return { kind: "split", areaId, edge: "top" };
      }
      if (card && prect.height >= MIN_SPLIT_AXIS * 2 && relY > 0.75) {
        card.classList.add("drop-bottom");
        marked = card;
        return { kind: "split", areaId, edge: "bottom" };
      }
      // divider上のdropは「直前のitemの後ろ」への挿入とみなす。
      const divEl = el?.closest<HTMLElement>(".ws-divider");
      const prevItem = divEl?.previousElementSibling instanceof HTMLElement
        && divEl.previousElementSibling.classList.contains("ws-item")
        ? divEl.previousElementSibling as HTMLElement
        : undefined;
      const pageEl = prevItem ?? el?.closest<HTMLElement>(".ws-page, .ws-item");
      if (pageEl && areaEl.contains(pageEl)) {
        const all = [...areaEl.querySelectorAll<HTMLElement>(".ws-page, .ws-item")];
        const idx = all.indexOf(pageEl);
        const rect = pageEl.getBoundingClientRect();
        const before = prevItem !== undefined ? false : ev.clientX < rect.left + rect.width / 2;
        pageEl.classList.add(before ? "drop-before" : "drop-after");
        marked = pageEl;
        return { kind: "into", areaId, index: idx + (before ? 0 : 1) };
      }
      return { kind: "into", areaId, index: Number.MAX_SAFE_INTEGER };
    }
    // tabsモード: カードの四辺帯=split、中央=Area末尾へ挿入。
    const card = el?.closest<HTMLElement>(".dock-card");
    if (card && areaEl.contains(card)) {
      const rect = card.getBoundingClientRect();
      const relX = (ev.clientX - rect.left) / rect.width;
      const relY = (ev.clientY - rect.top) / rect.height;
      const dx = Math.min(relX, 1 - relX);
      const dy = Math.min(relY, 1 - relY);
      if (Math.min(dx, dy) < 0.25) {
        const edge: DropEdge = dx < dy
          ? (relX < 0.5 ? "left" : "right")
          : (relY < 0.5 ? "top" : "bottom");
        // 分割後の葉が小さすぎるならsplitせず挿入にフォールバック。
        const axis = edge === "left" || edge === "right" ? rect.width : rect.height;
        if (axis >= MIN_SPLIT_AXIS * 2) {
          card.classList.add(`drop-${edge}`);
          marked = card;
          return { kind: "split", areaId, edge };
        }
      }
      return { kind: "into", areaId, index: Number.MAX_SAFE_INTEGER };
    }
    // カード外・タブ帯外（leaf内のgapなど）はleaf末尾への挿入。
    return { kind: "into", areaId, index: Number.MAX_SAFE_INTEGER };
  };

  const pressTab = (ref: PanelRef, event: PointerEvent) => {
    if (event.button !== 0) return;
    pending = { ref, x: event.clientX, y: event.clientY };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKeyDown, true);
      dragRef = null;
      pending = null;
      clearMarked();
      setGhost(undefined);
    };
    const onMove = (ev: PointerEvent) => {
      if (pending && Math.hypot(ev.clientX - pending.x, ev.clientY - pending.y) > 5) {
        dragRef = pending.ref;
        pending = null;
        setGhost({ x: ev.clientX, y: ev.clientY, title: deps.panelTitle(dragRef) });
      }
      if (!dragRef) return;
      setGhost((g) => g && { ...g, x: ev.clientX, y: ev.clientY });
      hitTest(ev);
    };
    const onEnd = (ev: PointerEvent) => {
      if (dragRef) {
        const hit = hitTest(ev);
        const target = deps.activeKey();
        if (hit?.kind === "into") deps.moveWsPanel(target, dragRef, hit.areaId, hit.index);
        if (hit?.kind === "split") deps.splitWsPanel(target, dragRef, hit.areaId, hit.edge);
        if (hit?.kind === "dock") deps.movePanelToDock(target, dragRef, hit.dock, hit.index);
        suppressSelectUntil = performance.now() + 250;
      }
      cleanup();
    };
    const onCancel = () => cleanup();
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        cleanup();
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKeyDown, true);
  };

  return {
    ghost,
    pressTab,
    suppressSelect: () => performance.now() < suppressSelectUntil,
  };
}
