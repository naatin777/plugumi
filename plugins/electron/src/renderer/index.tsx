// file://ではパスroutingが使えないためhashHistoryを使う（webと同じ
// route定義で、core key以降のrouteは同じ）。
import { render } from "@solidjs/web";
import { createRouter, hashHistory } from "@solidjs/router";
import { ShellHostProvider, initTheme, loadPrefs, shellRoutes } from "@plugumi/plugin-shell";
import { ipcShellHost } from "./ipc-host";

const host = ipcShellHost();
const Router = createRouter({ routes: shellRoutes, history: hashHistory() });
initTheme(() => loadPrefs().theme);
render(
  () => (
    <ShellHostProvider value={host}>
      <Router />
    </ShellHostProvider>
  ),
  document.getElementById("root")!,
);
