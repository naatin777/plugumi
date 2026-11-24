// 利用側のvite.configからimportするbuild設定の断片。
// Electronでも使うためvite本体への依存は持たせない（構造だけ返す）。

// @fontsourceからwoff2だけを取り込むtransform plugin。
// format固有の宣言を消してサイズを減らす。
export function woff2Only() {
  return {
    name: "plugumi-fontsource-woff2-only",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (!id.includes("@fontsource") || !id.endsWith(".css")) return null;
      // src行は woff2 と woff を1行に並べているので、woffのurl(...)だけを
      // 取り除く。行単位で消すとwoff2も道連れになる。
      const kept = code.replace(
        /,?\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g,
        "",
      );
      return { code: kept, map: null };
    },
  };
}
