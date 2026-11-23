// 領域をまたぐPanelのdrag & drop（designs/00004「Panelのタブはregionを
// またいでドラッグできる」）。HTML5 DnDではなくpointer eventで追う。
// drop先はdocument.elementFromPointで見つけ、祖先を辿って登録済みの
// 最も内側の要素を採る（stripがdockより内側にあればstripが勝つ）。
// class名での要素探索はしない。getBoundingClientRectはこのファイル内だけで
// 使う（登録要素の中でのindex/edgeの計算）。
import type { MoveTarget } from "../layout/model.ts";
import type { AreaController } from "./controller.tsx";
import { areaKey } from "../layout/area-list.ts";

export type DropTester = (
  element: HTMLElement, x: number, y: number, session: DragSession,
) => MoveTarget | null;

export interface DragSession {
  instanceId: string;
  title: string;
  // dragを始めたAreaController。同じcontrollerへのdropは区域内の移動、
  // 別controllerへのdropはInstanceごとの移譲になる。
  area: AreaController;
}

export interface StartOptions {
  // 閾値未満で離されたときのclick扱い（tabの選択など）。
  onClick?: () => void;
}

export interface DragController {
  start(session: DragSession, event: PointerEvent, options?: StartOptions): void;
  // 返り値は登録解除。要素が外れたら必ず呼ぶ（閉じた領域はdrop先にしない）。
  // drop先がどのAreaControllerに属するかも一緒に持つ。
  register(area: AreaController, element: HTMLElement, test: DropTester): () => void;
  session(): DragSession | null;
  overElement(): HTMLElement | null;
  onDrop: (session: DragSession, target: MoveTarget, area: AreaController) => void;
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
  onDrop: (session: DragSession, target: MoveTarget, area: AreaController) => void,
): DragController {
  const targets = new Map<HTMLElement, { area: AreaController; test: DropTester }>();
  let session: DragSession | null = null;
  let onClick: (() => void) | null = null;
  let over: HTMLElement | null = null;
  let overArea: AreaController | null = null;
  let overTarget: MoveTarget | null = null;
  let startX = 0;
  let startY = 0;
  let active = false;

  // pointer直下の要素から祖先を辿り、登録済みでtesterが非nullを返す
  // 最も内側をdrop先にする。
  const pick = (x: number, y: number): void => {
    over = null;
    overArea = null;
    overTarget = null;
    if (!session) return;
    let node = document.elementFromPoint(x, y);
    while (node) {
      const found = targets.get(node as HTMLElement);
      if (found) {
        // 同じAreaをMainとSubに出しているときは別controllerへのdropを
        // 受け付けない（両者が別々にworkspaceを保存するので、移すと片方の
        // 保存で消える）。testerに届かず印も出ない。
        const sameRef =
          found.area !== session.area &&
          found.area.ref() !== null &&
          session.area.ref() !== null &&
          areaKey(found.area.ref()!) === areaKey(session.area.ref()!);
        if (!sameRef) {
          const target = found.test(node as HTMLElement, x, y, session);
          if (target) {
            over = node as HTMLElement;
            overArea = found.area;
            overTarget = target;
            break;
          }
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
    let droppedArea: AreaController | null = null;
    if (dropped && dragged) {
      pick(event.clientX, event.clientY);
      target = overTarget;
      droppedArea = overArea;
    }
    session = null;
    onClick = null;
    active = false;
    setGhost(null);
    setOver(null);
    if (current && dragged && target && droppedArea) {
      onDrop(current, target, droppedArea);
    }
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
    register(area, element, test) {
      targets.set(element, { area, test });
      return () => targets.delete(element);
    },
    session: () => session,
    overElement: () => over,
    onDrop,
  };
}

// ポインタが要素の矩形内にあるか。
const inside = (element: HTMLElement, x: number, y: number): boolean => {
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
};

// 挿入indexを計算する。子要素の中心を越えた分だけ進める。
const insertIndex = (element: HTMLElement, pos: number, axis: "x" | "y"): number => {
  let index = 0;
  for (const child of element.children) {
    const rect = child.getBoundingClientRect();
    const center = axis === "x" ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
    if (pos >= center) index++;
  }
  return index;
};

// 横strip（dock・leafのtab帯）のdrop判定。
export const stripTest = (target: (index: number) => MoveTarget): DropTester =>
  (element, x, y) => {
    if (!inside(element, x, y)) return null;
    return target(insertIndex(element, x, "x"));
  };

// leaf本体のdrop判定。縁に近ければsplit、中央なら末尾挿入。
// leafIdはdrop時点の値を読む（leafはloadで差し替わるため値渡しだと腐る）。
export const leafBodyTest = (leafId: () => string): DropTester =>
  (element, x, y) => {
    if (!inside(element, x, y)) return null;
    const rect = element.getBoundingClientRect();
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

// 本体がstripに見えない場合（空dock・navのsection等）の矩形判定。
export const bodyTest = (target: MoveTarget): DropTester =>
  (element, x, y) => {
    if (!inside(element, x, y)) return null;
    return target;
  };
