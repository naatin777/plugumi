// Plugin View: Plugin が提供する Panel・Embed・Indicator を作るための
// 配布用パッケージ（contracts/00005）。値は持たず型とCSS変数名だけを共有する。

// Panel の mount に渡される宿主コンテキスト。
export interface PanelContext {
  callTool(toolPath: string, input: unknown): Promise<unknown>;
  // Panelの活動状態をShellへ通知する。Pluginは意味だけ渡し、
  // 色・速度・太さなどの表現はShell側のtokenが決める。
  // 呼ぶたびに全体を置き換える。永続化されず再mountで消える。
  setActivity(activity: PanelActivity | null): void;
}

export type PanelActivityTone = "neutral" | "info" | "success" | "warning" | "danger";
export type PanelActivitySurface = "header" | "border" | "divider" | "content";
export type PanelActivityEffect = "static" | "flow" | "glow";

export type PanelActivityProgress =
  | { kind: "determinate"; value: number }
  | { kind: "indeterminate" };

export interface PanelActivityLayer {
  surface: PanelActivitySurface;
  tone: PanelActivityTone;
  effect?: PanelActivityEffect;
}

export interface PanelActivity {
  busy?: boolean;
  progress?: PanelActivityProgress;
  layers?: PanelActivityLayer[];
}

export interface PanelHandle {
  destroy(): void;
}

export type PanelMount = (host: HTMLElement, context: PanelContext) => PanelHandle | Promise<PanelHandle>;

// plugin-shell の styles/tokens.css が定義するCSS変数名の正本。
// 値はここには持たない。test/tokens.test.mjs が tokens.css と一致を検査する。
export const tokenNames = {
  colors: {
    canvas: "--plugumi-colors-canvas",
    surface: "--plugumi-colors-surface",
    surfaceSubtle: "--plugumi-colors-surface-subtle",
    surfaceRaised: "--plugumi-colors-surface-raised",
    surfaceHover: "--plugumi-colors-surface-hover",
    surfaceActive: "--plugumi-colors-surface-active",
    text: "--plugumi-colors-text",
    textStrong: "--plugumi-colors-text-strong",
    textMuted: "--plugumi-colors-text-muted",
    textSubtle: "--plugumi-colors-text-subtle",
    codeText: "--plugumi-colors-code-text",
    border: "--plugumi-colors-border",
    borderStrong: "--plugumi-colors-border-strong",
    borderHighlight: "--plugumi-colors-border-highlight",
    accent: "--plugumi-colors-accent",
    accentContrast: "--plugumi-colors-accent-contrast",
    accentSurface: "--plugumi-colors-accent-surface",
    accentBorder: "--plugumi-colors-accent-border",
    accentMuted: "--plugumi-colors-accent-muted",
    error: "--plugumi-colors-error",
    errorContrast: "--plugumi-colors-error-contrast",
    errorSurface: "--plugumi-colors-error-surface",
    errorBorder: "--plugumi-colors-error-border",
    warning: "--plugumi-colors-warning",
    warningContrast: "--plugumi-colors-warning-contrast",
    warningSurface: "--plugumi-colors-warning-surface",
    warningBorder: "--plugumi-colors-warning-border",
    success: "--plugumi-colors-success",
    successContrast: "--plugumi-colors-success-contrast",
    successSurface: "--plugumi-colors-success-surface",
    successBorder: "--plugumi-colors-success-border",
    info: "--plugumi-colors-info",
    infoContrast: "--plugumi-colors-info-contrast",
    infoSurface: "--plugumi-colors-info-surface",
    infoBorder: "--plugumi-colors-info-border",
    activity1: "--plugumi-colors-activity-1",
    activity2: "--plugumi-colors-activity-2",
    activity3: "--plugumi-colors-activity-3",
    activity4: "--plugumi-colors-activity-4",
    activity5: "--plugumi-colors-activity-5",
  },
  fontFamily: {
    sans: "--plugumi-font-family-sans",
    mono: "--plugumi-font-family-mono",
  },
  fontSize: {
    "2xs": "--plugumi-font-size-2xs",
    xs: "--plugumi-font-size-xs",
    sm: "--plugumi-font-size-sm",
    md: "--plugumi-font-size-md",
    lg: "--plugumi-font-size-lg",
    xl: "--plugumi-font-size-xl",
    "2xl": "--plugumi-font-size-2xl",
  },
  fontWeight: {
    regular: "--plugumi-font-weight-regular",
    medium: "--plugumi-font-weight-medium",
    semibold: "--plugumi-font-weight-semibold",
    bold: "--plugumi-font-weight-bold",
  },
  letterSpacing: {
    tight: "--plugumi-letter-spacing-tight",
    normal: "--plugumi-letter-spacing-normal",
    wide: "--plugumi-letter-spacing-wide",
  },
  lineHeight: {
    "2xs": "--plugumi-line-height-2xs",
    xs: "--plugumi-line-height-xs",
    sm: "--plugumi-line-height-sm",
    md: "--plugumi-line-height-md",
    lg: "--plugumi-line-height-lg",
    xl: "--plugumi-line-height-xl",
    "2xl": "--plugumi-line-height-2xl",
  },
  radii: {
    sm: "--plugumi-radii-sm",
    md: "--plugumi-radii-md",
    lg: "--plugumi-radii-lg",
  },
  spacing: {
    xs: "--plugumi-spacing-xs",
    sm: "--plugumi-spacing-sm",
    md: "--plugumi-spacing-md",
    lg: "--plugumi-spacing-lg",
    xl: "--plugumi-spacing-xl",
  },
} as const;

export function cssVar(name: string): string {
  return `var(${name})`;
}
