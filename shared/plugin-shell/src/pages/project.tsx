// Projectの画面（/<core>/<project>/…）。controllerを立てて
// ShellFrameを置くだけ。中身は全てshell/*が受け持つ。
// ?window=floating はFloatingのArea専用: Area list・Sub・title barを
// 出さず、そのAreaView1個だけを描く。
import type { JSX } from "@solidjs/web";
import { useParams, useSearchParams } from "@solidjs/router";
import { Show } from "solid-js";
import { useShellHost } from "../host.tsx";
import {
  createShellController, createAreaController, ShellContext, useShell,
} from "../shell/controller.tsx";
import { ShellFrame } from "../shell/shell.tsx";
import { AreaView, DragGhost } from "../shell/area-view.tsx";

export default function ProjectPage(): JSX.Element {
  const host = useShellHost();
  const params = useParams();
  const controller = createShellController(host, () => params);
  return (
    <ShellContext value={controller}>
      <FloatingOrShell />
    </ShellContext>
  );
}

function FloatingOrShell(): JSX.Element {
  const [search] = useSearchParams();
  return (
    <Show when={search.window === "floating"} fallback={<ShellFrame />}>
      <FloatingArea />
    </Show>
  );
}

function FloatingArea(): JSX.Element {
  const shell = useShell();
  const params = useParams();
  const area = createAreaController(shell, () => {
    const path = shell.areaPath();
    return path.length > 0 ? { project: params.project ?? "", path } : null;
  });
  return (
    <main class={{ shell: true, floating: true, "no-aurora": !shell.prefs().aurora }}>
      {/* 最低限のtitle帯（窓のdrag領域）だけ残す。 */}
      <header class="work-title floating-title" />
      <AreaView area={area} slot="floating" />
      <DragGhost area={area} />
    </main>
  );
}
