// Route定義。Routerは利用側がhistoryを選んでcreateRouterする
// （webはbrowserHistory、ElectronはhashHistory）。
import { defineRoutes } from "@solidjs/router";
import CoreListPage from "./pages/core-list.tsx";
import CoreRedirect from "./pages/core-redirect.tsx";
import ProjectPage from "./pages/project.tsx";
import LabPage from "./pages/lab.tsx";

export const shellRoutes = defineRoutes([
  { path: "/", component: CoreListPage },
  { path: "/lab", component: LabPage },
  // 静的な/lab以下のrouteは/:core/:projectより先に解決される
  // （routerは静的segmentを動的より優先する）。
  { path: "/:core", component: CoreRedirect },
  { path: "/:core/:project", component: ProjectPage },
  { path: "/:core/:project/*areaPath", component: ProjectPage },
]);
