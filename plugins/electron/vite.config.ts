import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import { woff2Only } from "@plugumi/plugin-shell/vite";

export default defineConfig({
  plugins: [woff2Only(), solid()],
  // file://で開くため、asset参照は相対パスにする（既定の"/"はファイルシステム
  // のルートを指して読めない）。
  base: "./",
  build: { outDir: "dist/renderer" },
});
