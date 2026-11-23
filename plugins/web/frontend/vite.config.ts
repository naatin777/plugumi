import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import { woff2Only } from "@plugumi/plugin-shell/vite";

// 開発時は /api を動作中のplugumi-webへ転送する。未設定ならproxyなし。
const target = process.env.PLUGUMI_WEB_URL;

export default defineConfig({
  plugins: [woff2Only(), solid()],
  server: target ? { proxy: { "/api": target, "/ui": target } } : {},
});
