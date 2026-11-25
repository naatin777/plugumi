// E2E用の入口。web-frontendのsrc/index.tsxと同じ組み立てで、
// hostだけin-memory実装に差し替える（本物のCore/Goサーバーには触れない）。
import { render } from "@solidjs/web";
import { browserHistory, createRouter } from "@solidjs/router";
import { ShellHostProvider, initTheme, loadPrefs, shellRoutes } from "../../src/index.ts";
import { createMemoryHost } from "./memory-host.ts";

const host = createMemoryHost();
const Router = createRouter({ routes: shellRoutes, history: browserHistory() });
initTheme(() => loadPrefs().theme);
render(
  () => (
    <ShellHostProvider value={host}>
      <Router />
    </ShellHostProvider>
  ),
  document.getElementById("root")!,
);
