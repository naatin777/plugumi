import { A } from "@solidjs/router";
import { createSignal, For, Show } from "solid-js";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-solid";
import type { AreaTree } from "../../host";

export function AreaTreeView(props: {
  nodes: AreaTree[];
  path: string[];
  base: string;
  active: string;
  onAdd: (parent: string[]) => void;
  onRemove: (path: string[]) => void;
}) {
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const toggle = (path: string) => {
    const next = new Set(expanded());
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpanded(next);
  };
  return (
    <ul class="area-tree">
      <For each={props.nodes}>
        {(node) => {
          const path = [...props.path, node.name];
          const joined = () => path.join("/");
          return (
            <li>
              <div class="area-row" classList={{ active: props.active === joined() }}>
                <Show when={node.areas.length > 0} fallback={<span class="area-tw" />}>
                  <button class="area-tw" onClick={() => toggle(joined())}>
                    <Show when={expanded().has(joined())} fallback={<ChevronRight size={12} />}>
                      <ChevronDown size={12} />
                    </Show>
                  </button>
                </Show>
                <A href={`${props.base}/${joined()}/`}>{node.name}</A>
                <button class="area-op" onClick={() => props.onAdd(path)}><Plus size={12} /></button>
                <button class="area-op" onClick={() => props.onRemove(path)}><X size={12} /></button>
              </div>
              <Show when={expanded().has(joined()) || props.active.startsWith(joined())}>
                <AreaTreeView
                  nodes={node.areas} path={path} base={props.base}
                  active={props.active} onAdd={props.onAdd} onRemove={props.onRemove}
                />
              </Show>
            </li>
          );
        }}
      </For>
    </ul>
  );
}
