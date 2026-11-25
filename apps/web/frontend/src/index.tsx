import { render } from "@solidjs/web";
import { browserHistory, createRouter } from "@solidjs/router";
import { ShellHostProvider, initTheme, loadPrefs, shellRoutes } from "@plugumi/workbench";
import { httpShellHost } from "./http-host";

const host = httpShellHost();
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
