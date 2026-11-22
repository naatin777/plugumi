// Route定義だけをexportする。<Router> の選択（Router/HashRouter等）は宿主側。
import { Route } from "@solidjs/router";
import CoreList from "./pages/core-list";
import CoreRedirect from "./pages/core-redirect";
import LabPage from "./pages/lab";
import ProjectPage from "./pages/project";

export function ShellRoutes() {
  return (
    <>
      <Route path="/" component={CoreList} />
      <Route path="/lab" component={LabPage} />
      <Route path="/:core" component={CoreRedirect} />
      <Route path="/:core/:project" component={ProjectPage} />
      <Route path="/:core/:project/*areaPath" component={ProjectPage} />
    </>
  );
}
