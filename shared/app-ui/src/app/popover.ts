// popoverはtop layerに出る。位置はCSS anchor positioningで解決する —
// showPopoverのsourceがimplicit anchorになり、anchor()がそれを参照する。
// 手動でrectを測ってfixedで置く方式は、scrollやresizeへの追従・
// viewport端のflipをブラウザに任せられないため廃止した。
export function openPopover(popover: HTMLElement, anchor: HTMLElement): void {
  if (!popover.matches(":popover-open")) popover.showPopover({ source: anchor });
}
