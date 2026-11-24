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
  // 床の虹色もやもや。消すとフラットな暗い床になる。
  aurora: boolean;
  // auroraの鮮やかさ（%）。0で無彩色に近づき、100が標準。
  auroraVivid: number;
  // 選択tabの面の濃さ（%）。カードのblur越しに床が見える濃度。
  tabAlpha: number;
}

const KEY = "plugumi:shell:prefs";

const defaults = (): ShellPrefs => ({
  sidebarOpen: true,
  sidebarWidth: 260,
  subOpen: false,
  subWidth: 480,
  theme: "system",
  // 既定はoff — 「デスクトップ→vibrancy→暗いframe→タイル」が素の世界。
  aurora: false,
  auroraVivid: 100,
  tabAlpha: 50,
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
    aurora: flag(saved.aurora, base.aurora),
    auroraVivid: clampPercent(saved.auroraVivid, 0, 200, base.auroraVivid),
    tabAlpha: clampPercent(saved.tabAlpha, 0, 100, base.tabAlpha),
  };
}

export function savePrefs(prefs: ShellPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // 保存できなくても画面は動かす
  }
}
