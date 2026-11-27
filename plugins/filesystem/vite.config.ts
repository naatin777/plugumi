// editor entryを単一ファイルのESM bundleにする。
// viewはbrowserがimportするので依存（CodeMirror含む）は全部入りにする。
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist-ui",
    lib: {
      entry: "src/editor.ts",
      formats: ["es"],
      fileName: () => "editor.js",
      cssFileName: "editor",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
    minify: true,
  },
});
