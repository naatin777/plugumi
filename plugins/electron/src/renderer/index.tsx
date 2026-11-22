// file://ではパスroutingが使えないためHashRouterを使う（webのRouterと同じ
// ShellRoutesを中に入れるだけで、core key以降のrouteは同じ）。
import { render } from "solid-js/web";
import { HashRouter } from "@solidjs/router";
import { ShellHostProvider, ShellRoutes } from "@plugumi/plugin-shell";
import { ipcShellHost } from "./ipc-host";

const host = ipcShellHost();
render(
  () => (
    <ShellHostProvider value={host}>
      <HashRouter>
        <ShellRoutes />
      </HashRouter>
    </ShellHostProvider>
  ),
  document.getElementById("root")!,
);
