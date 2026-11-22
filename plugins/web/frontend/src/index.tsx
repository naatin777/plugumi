import { render } from "solid-js/web";
import { Router } from "@solidjs/router";
import { ShellHostProvider, ShellRoutes } from "@plugumi/plugin-shell";
import { httpShellHost } from "./http-host";

const host = httpShellHost();
render(
  () => (
    <ShellHostProvider value={host}>
      <Router>
        <ShellRoutes />
      </Router>
    </ShellHostProvider>
  ),
  document.getElementById("root")!,
);
