// Route定義。Routerは利用側がhistoryを選んでcreateRouterする。
import { defineRoutes } from "@solidjs/router";
import CoreListPage from "./pages/core-list.tsx";
import CoreRedirect from "./pages/core-redirect.tsx";
import ProjectPage from "./pages/project.tsx";

export const appRoutes = defineRoutes([
  { path: "/", component: CoreListPage },
  { path: "/:core", component: CoreRedirect },
  { path: "/:core/:project", component: ProjectPage },
  { path: "/:core/:project/*areaPath", component: ProjectPage },
]);
