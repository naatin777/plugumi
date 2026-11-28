// 端末ごとの表示設定。Workspaceの保存とは分け、1つのlocalStorageキーに
// まとめる（designs/00005「開閉・幅・テーマなど端末ごとの表示設定」）。
// localStorageが使えない環境でも落ちないよう、読み書きはtry/catchで包む。
export type ThemeMode = "system" | "light" | "dark";

export interface ShellPrefs {
  // Area list（左の列）の開閉と幅。
  sidebarOpen: boolean;
  sidebarWidth: number;
  // Sub列（右のAreaView）の開閉と幅。
  subOpen: boolean;
  subWidth: number;
  theme: ThemeMode;
  // Layer 0の背景（decisions/00041）。aurora=虹色もやもや、image=好きな
  // 画像、none=無し（膜の色だけの床）。画像はbackgroundImageに入る。
  background: "none" | "aurora" | "image";
  // ユーザーが選んだ背景画像。downscaleしたJPEGのdata URL。
  backgroundImage: string;
  // auroraの鮮やかさ（%）。0で無彩色に近づき、100が標準。
  auroraVivid: number;
  // 膜（Layer 1）のblur量（px）。browserでは背景要素自体にかける
  // （backdrop-filterではなくsource側 — 全面blurを毎frame合成しない）。
  membraneBlur: number;
  // 床に敷くframe色の濃さ（%）。vibrancy宿主ではデスクトップの
  // 上に乗る暗さの量。ブラウザでは下地が同色なので見た目不変。
  frameAlpha: number;
  // 選択tabの面の濃さ（%）。カードのblur越しに床が見える濃度。
  tabAlpha: number;
  // UI・本文フォントのfamily名。無ければ同梱のIBM Plex Sansへ、
  // それも無ければsystem sansへ落ちる。
  sansFont: string;
  // monoフォントのfamily名。無ければ同梱のIBM Plex Monoへ、
  // それも無ければsystem monoへ落ちる（sansと同じ構造）。
  monoFont: string;
}

const KEY = "plugumi:shell:prefs";

const defaults = (): ShellPrefs => ({
  sidebarOpen: true,
  sidebarWidth: 260,
  subOpen: false,
  subWidth: 480,
  theme: "system",
  // 既定はnone — 「デスクトップ→vibrancy→暗いframe→タイル」が素の世界。
  background: "none",
  backgroundImage: "",
  auroraVivid: 100,
  membraneBlur: 80,
  frameAlpha: 60,
  tabAlpha: 50,
  sansFont: "IBM Plex Sans",
  monoFont: "IBM Plex Mono",
});

const clampWidth = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(960, Math.max(80, value))
    : fallback;

const clampPercent = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

// 形が合わないフィールドだけ既定に戻す。キー全体が壊れていれば全既定。
export function loadPrefs(): ShellPrefs {
  const base = defaults();
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return base;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return base;
  const saved = raw as Record<string, unknown>;
  const flag = (value: unknown, fallback: boolean): boolean =>
    typeof value === "boolean" ? value : fallback;
  const theme = saved.theme;
  return {
    sidebarOpen: flag(saved.sidebarOpen, base.sidebarOpen),
    sidebarWidth: clampWidth(saved.sidebarWidth, base.sidebarWidth),
    subOpen: flag(saved.subOpen, base.subOpen),
    subWidth: clampWidth(saved.subWidth, base.subWidth),
    theme: theme === "light" || theme === "dark" || theme === "system" ? theme : base.theme,
    background: (() => {
      const bg = saved.background;
      if (bg === "aurora" || bg === "image" || bg === "none") return bg;
      // 旧pref（aurora boolean）からの移行。
      if (typeof saved.aurora === "boolean") return saved.aurora ? "aurora" : "none";
      return base.background;
    })(),
    backgroundImage: typeof saved.backgroundImage === "string" ? saved.backgroundImage : base.backgroundImage,
    auroraVivid: clampPercent(saved.auroraVivid, 0, 200, base.auroraVivid),
    membraneBlur: clampPercent(saved.membraneBlur, 0, 100, base.membraneBlur),
    frameAlpha: clampPercent(saved.frameAlpha, 0, 100, base.frameAlpha),
    tabAlpha: clampPercent(saved.tabAlpha, 0, 100, base.tabAlpha),
    sansFont: typeof saved.sansFont === "string" ? saved.sansFont : base.sansFont,
    monoFont: typeof saved.monoFont === "string" ? saved.monoFont : base.monoFont,
  };
}

export function savePrefs(prefs: ShellPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // 保存できなくても画面は動かす
  }
}
