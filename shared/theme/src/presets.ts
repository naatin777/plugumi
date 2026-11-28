// 同梱の背景preset。デバッグ・評価用に「具体的な画像」がすぐ使える
// ようにするためのもので、ユーザー画像の代替ではない。
// 画像はpicsum.photos（Unsplash由来）のものを800pxに圧縮した —
// ライセンス上問題があれば差し替える。性質の違う3枚:
//   land:  空（低周波）+山・川（高周波）の典型的なwallpaper
//   city:  都市 — 全体が高周波。最悪に近い実画像
//   light: 明るい画像 — lightな背後での見え方の確認用
import landUrl from "./presets/land.jpg";
import cityUrl from "./presets/city.jpg";
import lightUrl from "./presets/light.jpg";

export interface BackgroundPreset {
  id: string;
  label: string;
  url: string;
}

export const backgroundPresets: readonly BackgroundPreset[] = [
  { id: "land", label: "山と川", url: landUrl },
  { id: "city", label: "都市", url: cityUrl },
  { id: "light", label: "明るい風景", url: lightUrl },
];

// prefsのbackgroundImageは「preset:<id>」かdata URL。描画側はこれで
// 実際のURLに解決する。
export function resolveBackgroundImage(value: string): string {
  if (value.startsWith("preset:")) {
    const id = value.slice("preset:".length);
    return backgroundPresets.find((preset) => preset.id === id)?.url ?? "";
  }
  return value;
}
