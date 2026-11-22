// @fontsourceのCSSはwoff2とwoffを両方参照する。distはGoバイナリ等に
// 同梱されるので、対応ブラウザがすべて読めるwoff2だけを残し、woffの参照を
// 消して出力させない。vite本体は利用側のものを使うため型には依存しない。
export function woff2Only() {
  return {
    name: "plugumi-woff2-only",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (!id.includes("/@fontsource/") || !id.endsWith(".css")) return null;
      return code.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, "");
    },
  };
}
