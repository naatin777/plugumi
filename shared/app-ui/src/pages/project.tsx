// Projectの画面（/<core>/<project>/…）。controllerを立てて
// ShellFrameを置くだけ。中身は全てshell/*が受け持つ。
// ?window=detached は別window（detach）専用: Area list・Sub・title barを
// 出さず、そのAreaView1個だけを描く（Electronの「別windowで開く」）。
import type { JSX } from "@solidjs/web";
import { useParams, useSearchParams } from "@solidjs/router";
import { Show } from "solid-js";
import { useShellHost } from "../host.tsx";
import {
  createShellController, createAreaController, ShellContext, useShell,
} from "../shell/controller.tsx";
import { ShellFrame } from "../shell/shell.tsx";
import { AreaView, DragGhost } from "../shell/area-view.tsx";
import "../shell/shell.css";
import "../shell/work-shape.css";
import { resolveBackgroundImage } from "plugumi-theme-panel";

export default function ProjectPage(): JSX.Element {
  const host = useShellHost();
  const params = useParams();
  const controller = createShellController(host, () => params);
  return (
    <ShellContext value={controller}>
      <DetachedOrShell />
    </ShellContext>
  );
}

function DetachedOrShell(): JSX.Element {
  const [search] = useSearchParams();
  return (
    <Show when={search.window === "detached"} fallback={<ShellFrame />}>
      <DetachedArea />
    </Show>
  );
}

function DetachedArea(): JSX.Element {
  const shell = useShell();
  const params = useParams();
  const area = createAreaController(shell, () => {
    const path = shell.areaPath();
    return path.length > 0 ? { project: params.project ?? "", path } : null;
  });
  return (
    <main
      class={{ ["shell"]: true, ["detached"]: true }}
      data-part="shell"
      data-bg={
        shell.prefs().background === "image" && !shell.prefs().backgroundImage
          ? "none"
          : shell.prefs().background
      }
      style={{
        "--aurora-vivid": shell.prefs().auroraVivid / 100,
        "--shell-frame-alpha": shell.prefs().frameAlpha / 100,
        "--membrane-blur": `${shell.prefs().membraneBlur}px`,
        "--shell-bg-image":
          shell.prefs().background === "image" && shell.prefs().backgroundImage
            ? `url(${resolveBackgroundImage(shell.prefs().backgroundImage)})`
            : "none",
      }}
    >
      {/* 最低限のtitle帯（窓のdrag領域）だけ残す。 */}
      <header class={"work-title"} />
      {/* Mainと同じ形で1個だけ描く。同じAreaを元windowと同時に
          開くと独立に保存されlast-write-winsになる。 */}
      <AreaView area={area} />
      <DragGhost />
    </main>
  );
}
