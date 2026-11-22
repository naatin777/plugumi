import { useNavigate, useParams } from "@solidjs/router";
import { createEffect, createResource, createSignal, Show } from "solid-js";
import { useShellHost, type AreaTree, type ProjectTree } from "../host";
import { loadLastLocation } from "../storage";
import ProjectPage from "./project";

// /:core/ はProject一覧を挟まずPlugin Shell の画面へ直行する。
// 最後に開いた場所 → 先頭のProject → なければPlugin Shellの画面（案内モード）の順。
export default function CoreRedirect() {
  const host = useShellHost();
  const params = useParams();
  const navigate = useNavigate();
  const key = () => params.core ?? "";
  const [projects] = createResource(key, (k) => host.listProjects(k));
  const [decided, setDecided] = createSignal(false);

  createEffect(() => {
    const trees = projects();
    if (!trees || decided()) return;
    const saved = loadLastLocation(key());
    if (saved && usableLocation(saved, trees)) {
      setDecided(true);
      navigate(saved, { replace: true });
      return;
    }
    if (trees.length > 0) {
      setDecided(true);
      navigate(`/${key()}/${trees[0].name}/`, { replace: true });
      return;
    }
    setDecided(true);
  });

  return (
    <Show when={decided()} fallback={<p class="placeholder">…</p>}>
      <ProjectPage />
    </Show>
  );
}

// 保存されたパス /<core>/<project>/<area...> の Project/Area が残っているか。
function usableLocation(location: string, trees: ProjectTree[]): boolean {
  const parts = location.split("/").filter((part) => part !== "");
  // parts = [core, project, ...area]
  if (parts.length < 2) return false;
  const project = trees.find((tree) => tree.name === parts[1]);
  if (!project) return false;
  return areaExists(project.areas, parts.slice(2));
}

function areaExists(areas: AreaTree[], path: string[]): boolean {
  if (path.length === 0) return true;
  const area = areas.find((node) => node.name === path[0]);
  return area !== undefined && areaExists(area.areas, path.slice(1));
}
