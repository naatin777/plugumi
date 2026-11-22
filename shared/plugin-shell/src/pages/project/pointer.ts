export const trackPointer = (
  handle: HTMLElement,
  event: PointerEvent,
  onMove: (ev: PointerEvent) => void,
  onEnd?: (ev: PointerEvent) => void,
) => {
  const cleanup = () => {
    handle.classList.remove("dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", cancel);
  };
  const end = (ev: PointerEvent) => {
    onEnd?.(ev);
    cleanup();
  };
  const cancel = () => cleanup();
  handle.classList.add("dragging");
  try {
    handle.setPointerCapture(event.pointerId);
  } catch {
    /* synthetic event等でpointerが存在しない場合は無視 */
  }
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", cancel);
};

// ドラッグ開始時にコンテナの全子を現在px寸法＝flex-grow値に固定し、
// 以後grow比をピクセル比率として増減させる（width指定の列も比率へ変換される）。
