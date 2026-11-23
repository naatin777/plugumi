// 領域をまたぐPanelのdrag & drop（designs/00004「Panelのタブはregionを
// またいでドラッグできる」）。HTML5 DnDではなくpointer eventで追う。
// drop先はdocument.elementFromPointで見つけ、祖先を辿って登録済みの
// 最も内側の要素を採る（stripがdockより内側にあればstripが勝つ）。
// class名での要素探索はしない。getBoundingClientRectはこのファイル内だけで
// 使う（登録要素の中でのindex/edgeの計算）。
import type { MoveTarget } from "../layout/model.ts";

// testerにはdrag中のsessionを渡す。panelとwidgetは別物なので、
// testerはsession.kindを見て自分の受け付ける種別かを先に判定する。
export type DropTester = (
  element: HTMLElement, x: number, y: number, session: DragSession,
) => MoveTarget | null;

export interface DragSession {
  instanceId: string;
  title: string;
  // panel=workspace内のtab、widget=pinnedの区画。相互変換はない。
  kind: "panel" | "widget";
}

export interface StartOptions {
  // 閾値未満で離されたときのclick扱い（tabの選択など）。
  onClick?: () => void;
}

export interface DragController {
  start(session: DragSession, event: PointerEvent, options?: StartOptions): void;
  // 返り値は登録解除。要素が外れたら必ず呼ぶ（閉じた領域はdrop先にしない）。
  register(element: HTMLElement, test: DropTester): () => void;
  session(): DragSession | null;
  overElement(): HTMLElement | null;
  onDrop: (instanceId: string, target: MoveTarget) => void;
}

// clickとdragを分ける閾値。drag.tsが一元管理し、tab stripは
// startのonClickを渡すだけにする（二重実装を置かない）。
const CLICK_THRESHOLD = 4;

// leafの縁に向けたdropは分割。領域が狭すぎる場合は末尾への挿入に戻す。
const EDGE_FRACTION = 0.2;
const EDGE_MIN_PX = 40;
const SPLIT_MIN_SIZE = 240;

export function createDragController(
  setGhost: (ghost: { x: number; y: number; title: string } | null) => void,
  setOver: (element: HTMLElement | null) => void,
  onDrop: (instanceId: string, target: MoveTarget) => void,
): DragController {
  const targets = new Map<HTMLElement, DropTester>();
  let session: DragSession | null = null;
  let onClick: (() => void) | null = null;
  let over: HTMLElement | null = null;
  let overTarget: MoveTarget | null = null;
  let startX = 0;
  let startY = 0;
  let active = false;

  // pointer直下の要素から祖先を辿り、登録済みでtesterが非nullを返す
  // 最も内側をdrop先にする。
  const pick = (x: number, y: number): void => {
    over = null;
    overTarget = null;
    if (!session) return;
    let node = document.elementFromPoint(x, y);
    while (node) {
      const test = targets.get(node as HTMLElement);
      if (test) {
        const target = test(node as HTMLElement, x, y, session);
        if (target) {
          over = node as HTMLElement;
          overTarget = target;
          break;
        }
      }
      node = node.parentElement;
    }
    setOver(over);
  };

  const move = (event: PointerEvent): void => {
    if (!active && Math.hypot(event.clientX - startX, event.clientY - startY) < CLICK_THRESHOLD) {
      return;
    }
    active = true;
    setGhost(session ? { x: event.clientX, y: event.clientY, title: session.title } : null);
    pick(event.clientX, event.clientY);
  };

  // dropで終わるupとcancelを分ける。cancelはdropしない（click扱いもしない）。
  const finish = (event: PointerEvent, dropped: boolean): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    const current = session;
    const click = onClick;
    const dragged = active;
    let target: MoveTarget | null = null;
    if (dropped && dragged) {
      pick(event.clientX, event.clientY);
      target = overTarget;
    }
    session = null;
    onClick = null;
    active = false;
    setGhost(null);
    setOver(null);
    if (current && dragged && target) onDrop(current.instanceId, target);
    if (dropped && current && !dragged && click) click();
  };
  const up = (event: PointerEvent): void => finish(event, true);
  const cancel = (event: PointerEvent): void => finish(event, false);

  return {
    start(next: DragSession, event: PointerEvent, options?: StartOptions) {
      if (session) return;
      session = next;
      onClick = options?.onClick ?? null;
      startX = event.clientX;
      startY = event.clientY;
      active = false;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
    },
    register(element, test) {
      targets.set(element, test);
      return () => targets.delete(element);
    },
    session: () => session,
    overElement: () => over,
    onDrop,
  };
}

// strip上の挿入indexを計算する。子要素の中心を越えた分だけ進める。
export const stripIndex = (element: HTMLElement, x: number): number => {
  let index = 0;
  for (const child of element.children) {
    const rect = child.getBoundingClientRect();
    if (x >= rect.left + rect.width / 2) index++;
  }
  return index;
};

// 横strip（dock・leafのtab帯）のdrop判定。panelのtab専用。
export const stripTest = (target: (index: number) => MoveTarget): DropTester =>
  (element, x, y, session) => {
    if (session.kind !== "panel") return null;
    const rect = element.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    return target(stripIndex(element, x));
  };

// 縦積み（pinnedのwidget列）の挿入index。子要素の中心を越えた分だけ進める。
export const columnIndex = (element: HTMLElement, y: number): number => {
  let index = 0;
  for (const child of element.children) {
    const rect = child.getBoundingClientRect();
    if (y >= rect.top + rect.height / 2) index++;
  }
  return index;
};

// 縦積みの列全体のdrop判定。widgetの並べ替え専用。
export const columnTest = (target: (index: number) => MoveTarget): DropTester =>
  (element, x, y, session) => {
    if (session.kind !== "widget") return null;
    const rect = element.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    return target(columnIndex(element, y));
  };

// leaf本体のdrop判定。縁に近ければsplit、中央なら末尾挿入。
// leafIdはdrop時点の値を読む（leafはloadで差し替わるため値渡しだと腐る）。
export const leafBodyTest = (leafId: () => string): DropTester =>
  (element, x, y, session) => {
    if (session.kind !== "panel") return null;
    const rect = element.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    const edgeX = Math.max(EDGE_MIN_PX, rect.width * EDGE_FRACTION);
    const edgeY = Math.max(EDGE_MIN_PX, rect.height * EDGE_FRACTION);
    const nearLeft = x - rect.left < edgeX;
    const nearRight = rect.right - x < edgeX;
    const nearTop = y - rect.top < edgeY;
    const nearBottom = rect.bottom - y < edgeY;
    // 分割後の葉が小さくなりすぎる向きはsplitしない。
    const id = leafId();
    if (nearLeft && rect.width >= SPLIT_MIN_SIZE) {
      return { region: "split", leafId: id, edge: "left" };
    }
    if (nearRight && rect.width >= SPLIT_MIN_SIZE) {
      return { region: "split", leafId: id, edge: "right" };
    }
    if (nearTop && rect.height >= SPLIT_MIN_SIZE) {
      return { region: "split", leafId: id, edge: "top" };
    }
    if (nearBottom && rect.height >= SPLIT_MIN_SIZE) {
      return { region: "split", leafId: id, edge: "bottom" };
    }
    return { region: "leaf", leafId: id, index: -1 };
  };

// 本体がstripに見えない場合（空dock等）の矩形判定。panel専用。
export const bodyTest = (target: MoveTarget): DropTester =>
  (element, x, y, session) => {
    if (session.kind !== "panel") return null;
    const rect = element.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    return target;
  };
