// Projectの画面（/<core>/<project>/…）。controllerを立てて
// AppFrameを置くだけ。中身は全てshell/*が受け持つ。
// ?window=detached は別window（detach）専用: Area list・Sub・title barを
// 出さず、そのAreaView1個だけを描く（Electronの「別windowで開く」）。
import type { JSX } from "@solidjs/web";
import { useParams, useSearchParams } from "@solidjs/router";
import { Show } from "solid-js";
import { useHost } from "../host.tsx";
import {
  createAppController, createAreaController, AppControllerContext, useApp,
} from "../app/controller.tsx";
import { AppFrame } from "../app/app-frame.tsx";
import { AreaView, DragGhost } from "../app/area-view.tsx";
import "../app/app-frame.css";
import "../app/app-shape.css";
import { resolveBackgroundImage } from "plugumi-theme-panel";

export default function ProjectPage(): JSX.Element {
  const host = useHost();
  const params = useParams();
  const controller = createAppController(host, () => params);
  return (
    <AppControllerContext value={controller}>
      <DetachedOrApp />
    </AppControllerContext>
  );
}

function DetachedOrApp(): JSX.Element {
  const [search] = useSearchParams();
  return (
    <Show when={search.window === "detached"} fallback={<AppFrame />}>
      <DetachedArea />
    </Show>
  );
}

function DetachedArea(): JSX.Element {
  const app = useApp();
  const params = useParams();
  const area = createAreaController(app, () => {
    const path = app.areaPath();
    return path.length > 0 ? { project: params.project ?? "", path } : null;
  });
  return (
    <main
      class={{ ["app"]: true, ["detached"]: true }}
      data-part="app"
      data-bg={
        app.prefs().background === "image" && !app.prefs().backgroundImage
          ? "none"
          : app.prefs().background
      }
      style={{
        "--aurora-vivid": app.prefs().auroraVivid / 100,
        "--app-frame-alpha": app.prefs().frameAlpha / 100,
        "--membrane-blur": `${app.prefs().membraneBlur}px`,
        "--app-bg-image":
          app.prefs().background === "image" && app.prefs().backgroundImage
            ? `url(${resolveBackgroundImage(app.prefs().backgroundImage)})`
            : "none",
      }}
    >
      {/* 最低限のtitle帯（窓のdrag領域）だけ残す。 */}
      <header class={"titlebar"} />
      {/* Mainと同じ形で1個だけ描く。同じAreaを元windowと同時に
          開くと独立に保存されlast-write-winsになる。 */}
      <AreaView area={area} />
      <DragGhost />
    </main>
  );
}
