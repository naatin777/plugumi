import { render } from "@solidjs/web";
import { browserHistory, createRouter } from "@solidjs/router";
import { HostProvider, initTheme, loadPrefs, appRoutes } from "@plugumi/app-ui";
import { httpHost } from "./http-host";

const host = httpHost();
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
