// popoverはtop layerに出るため、位置を明示しないとUAの既定位置（左上）に出る。
// anchor()のimplicit anchorは環境によって解決されないので、開くたびに
// anchorのrectから明示的にfixedで置く。
export type PopoverAlign = "start" | "end" | "center";

export function placePopover(
  popover: HTMLElement,
  anchor: HTMLElement,
  align: PopoverAlign = "start",
): void {
  const gap = 4;
  const rect = anchor.getBoundingClientRect();
  const pr = popover.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  let top = rect.bottom + gap;
  // 下に入らなければ上へ、それでも駄目ならviewport内にclampする。
  if (top + pr.height > vh - gap && rect.top - gap - pr.height >= gap) {
    top = rect.top - gap - pr.height;
  } else {
    top = Math.min(top, Math.max(gap, vh - gap - pr.height));
  }
  const left = Math.min(
    Math.max(gap, align === "end"
      ? rect.right - pr.width
      : align === "center"
        ? rect.left + rect.width / 2 - pr.width / 2
        : rect.left),
    Math.max(gap, vw - gap - pr.width),
  );
  popover.style.position = "fixed";
  popover.style.inset = "auto";
  popover.style.margin = "0";
  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

export function openPopover(
  popover: HTMLElement,
  anchor: HTMLElement,
  align: PopoverAlign = "start",
): void {
  if (!popover.matches(":popover-open")) popover.showPopover();
  placePopover(popover, anchor, align);
}
