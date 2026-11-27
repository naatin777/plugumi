// panel entryを単一ファイルのESM bundleにする。
// viewはbrowserがimportするので依存（@plugumi/view）は全部入りにする。
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist-ui",
    lib: {
      entry: "src/panel.ts",
      formats: ["es"],
      fileName: () => "panel.js",
    },
    rollupOptions: {
      // 依存は全てbundleする（externalなし）。
      output: { inlineDynamicImports: true },
    },
    minify: false,
  },
});
