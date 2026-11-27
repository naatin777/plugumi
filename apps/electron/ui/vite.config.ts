import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  plugins: [solid()],
  build: {
    // mount(host, context)をexportするESM 1ファイルにまとめる。
    // CSSはsite.cssとして分けて出す。panel宣言はmainプロセスのコードにあり、
    // manifestのscanとsha256計算はruntimeがrootから動的に行う
    // （contracts/00004のpull model — plugumi-ui.jsonは不要）。
    lib: {
      entry: { site: "src/site-entry.tsx" },
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
      cssFileName: "site",
    },
    outDir: "dist",
  },
});
