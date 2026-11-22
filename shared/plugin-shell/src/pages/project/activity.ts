import type { PanelRef } from "../../host";
import { PanelInstance } from "../../panels/instance";
import type { PanelActivitySurface } from "@plugumi/plugin-view";

// PluginのsetActivity通知をdata属性へ写す。色・速度・太さなどの表現はCSS側。
export const actLayerOf = (instance: PanelInstance, surface: PanelActivitySurface) =>
  instance.activity()?.layers?.find((layer) => layer.surface === surface);
export const actEffectOf = (instance: PanelInstance, surface: PanelActivitySurface) => {
  const layer = actLayerOf(instance, surface);
  return layer ? (layer.effect ?? "static") : undefined;
};
export const actToneOf = (instance: PanelInstance) =>
  actLayerOf(instance, "border")?.tone ?? actLayerOf(instance, "divider")?.tone
  ?? actLayerOf(instance, "content")?.tone ?? actLayerOf(instance, "header")?.tone;
export const actProgressOf = (instance: PanelInstance) => {
  const progress = instance.activity()?.progress;
  return progress?.kind === "determinate"
    ? `--act-progress: ${Math.min(100, Math.max(0, progress.value))}%` : undefined;
};
// cardのactivity属性は「そのcardが見せているpanel（selected、無ければ先頭）」のもの。
// CSS変数は下方向にしか継承しないので、外周を描くcard自身に属性が要る。
export const cardInst = (
  instance: (ref: PanelRef) => PanelInstance,
  panels: PanelRef[],
  selected?: string,
) => {
  const ref = panels.find((p) => p.instanceId === selected) ?? panels[0];
  return ref ? instance(ref) : undefined;
};
