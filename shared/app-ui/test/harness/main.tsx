// E2E用の入口。web-frontendのsrc/index.tsxと同じ組み立てで、
// hostだけin-memory実装に差し替える（本物のCore/Goサーバーには触れない）。
import { render } from "@solidjs/web";
import { browserHistory, createRouter } from "@solidjs/router";
import { HostProvider, initTheme, loadPrefs, appRoutes } from "../../src/index.ts";
import { createMemoryHost } from "./memory-host.ts";

const host = createMemoryHost();
const Router = createRouter({ routes: appRoutes, history: browserHistory() });
initTheme(() => loadPrefs().theme);
render(
  () => (
    <HostProvider value={host}>
      <Router />
    </HostProvider>
  ),
  document.getElementById("root")!,
);
