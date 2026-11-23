// Activity表示（designs/00005）。Pluginは意味だけを通知し、
// 色・速度・太さはShell側のtokenが決める。描画はDOMのdata属性で行い、
// CSSが読み取る。busyはaria-busyへ写す。永続化しない、再mountで消える。

export type ActivitySurface = "header" | "border" | "divider" | "content";
export type ActivityTone = "neutral" | "info" | "success" | "warning" | "danger";
export type ActivityEffect = "static" | "flow" | "glow";

export interface ActivityLayer {
  surface: ActivitySurface;
  tone: ActivityTone;
  effect: ActivityEffect;
}

export type ActivityProgress =
  | { kind: "determinate"; value: number }
  | { kind: "indeterminate" };

export interface ActivityState {
  busy: boolean;
  progress?: ActivityProgress;
  layers: ActivityLayer[];
}

// 1つのsurfaceには最後のlayerを採用する（重複指定は意味を持たないため）。
export function activityAttrs(
  state: ActivityState | undefined,
): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!state) return attrs;
  for (const layer of state.layers) {
    attrs[`data-activity-${layer.surface}`] = `${layer.tone} ${layer.effect}`;
  }
  return attrs;
}

// 指定したsurfaceだけを取り出す（tabにはheader、stripにはdividerなど）。
export function surfaceAttrs(
  state: ActivityState | undefined,
  ...surfaces: ActivitySurface[]
): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!state) return attrs;
  for (const layer of state.layers) {
    if (surfaces.includes(layer.surface)) {
      attrs[`data-activity-${layer.surface}`] = `${layer.tone} ${layer.effect}`;
    }
  }
  return attrs;
}

// tab/section header用: busyをaria-busyに写す。
export function busyAttr(state: ActivityState | undefined): Record<string, string> {
  return state?.busy ? { "aria-busy": "true" } : {};
}

// stripと内容の境界線用: divider面だけを取り出す。
export function dividerAttr(state: ActivityState | undefined): Record<string, string> {
  return surfaceAttrs(state, "divider");
}
