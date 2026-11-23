// Projectの画面（/<core>/<project>/…）。controllerを立てて
// ShellFrameを置くだけ。中身は全てshell/*が受け持つ。
import type { JSX } from "@solidjs/web";
import { useParams } from "@solidjs/router";
import { useShellHost } from "../host.tsx";
import { createShellController, ShellContext } from "../shell/controller.tsx";
import { ShellFrame } from "../shell/shell.tsx";

export default function ProjectPage(): JSX.Element {
  const host = useShellHost();
  const params = useParams();
  const controller = createShellController(host, () => params);
  return (
    <ShellContext value={controller}>
      <ShellFrame />
    </ShellContext>
  );
}
