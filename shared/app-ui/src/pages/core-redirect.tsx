// /<core>/ の入口。Project一覧の画面は挟まず、次の順でredirectする:
// 1. この端末で最後に開いた場所（localStorage）
// 2. 先頭のProject
// 3. Projectが1つも無ければPlugin Shellの画面そのもの（案内モード）
import { createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useNavigate, useParams } from "@solidjs/router";
import { useHost } from "../host.tsx";
import { loadLastLocation } from "../storage.ts";
import { findArea } from "../app/controller.tsx";
import ProjectPage from "./project.tsx";

export default function CoreRedirect(): JSX.Element {
  const host = useHost();
  const params = useParams();
  const navigate = useNavigate();
  const key = () => params.core ?? "";
  const [empty, setEmpty] = createSignal(false);

  const decide = async () => {
    try {
      const projects = await host.listProjects(key());
      const saved = loadLastLocation(key());
      // 保存されていた場所のProjectとAreaがまだ残っているときだけ戻る
      if (saved.startsWith(`/${key()}/`)) {
        const parts = saved.slice(key().length + 2).split("/").filter(Boolean).map(decodeURIComponent);
        const tree = projects.find((project) => project.key === parts[0]);
        if (tree && findArea(tree.areas, parts.slice(1))) {
          navigate(saved, { replace: true });
          return;
        }
      }
      const first = projects[0];
      if (first) {
        navigate(`/${key()}/${first.key}/`, { replace: true });
        return;
      }
      setEmpty(true);
    } catch {
      setEmpty(true);
    }
  };
  void decide();

  return (
    <Show when={empty()}>
      <ProjectPage />
    </Show>
  );
}
