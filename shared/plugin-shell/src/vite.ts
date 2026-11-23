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
      // woff2以外のsrc行を消す。残した行だけでCSSとして成り立つ。
      const kept = code
        .split("\n")
        .filter((line) => !line.includes(".woff") || line.includes(".woff2"));
      return { code: kept.join("\n"), map: null };
    },
  };
}
