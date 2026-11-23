// workspace中央のsplit木。axisに沿ってfirst/secondを並べ、間の溝で
// ratioを変える。空の領域は「+」でPanelを足す。
import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { Node, Split } from "../layout/model.ts";
import { useShell, layoutOps } from "./controller.tsx";
import { LeafView } from "./leaf.tsx";
import { Resizer } from "./resizer.tsx";

export function CenterView(): JSX.Element {
  const shell = useShell();
  const root = () => shell.layout().workspace.center.root;
  return (
    <div class="center" data-region="center">
      <NodeView node={root()} />
    </div>
  );
}

export function NodeView(props: { node: Node }): JSX.Element {
  const leaf = () => (props.node.kind === "leaf" ? props.node : undefined);
  const split = () => (props.node.kind === "split" ? props.node : undefined);
  return (
    <Show when={split()} fallback={<Show when={leaf()}>{(node) => <LeafView leaf={node()} />}</Show>}>
      {(node) => <SplitView split={node()} />}
    </Show>
  );
}

function SplitView(props: { split: Split }): JSX.Element {
  const ops = layoutOps(useShell());
  let element!: HTMLDivElement;
  return (
    <div
      ref={element}
      class="split"
      data-axis={props.split.axis}
      style={props.split.axis === "x"
        ? { "grid-template-columns": `${props.split.ratio}fr var(--work-gap) ${1 - props.split.ratio}fr` }
        : { "grid-template-rows": `${props.split.ratio}fr var(--work-gap) ${1 - props.split.ratio}fr` }}
    >
      <NodeView node={props.split.first} />
      <Resizer
        axis={props.split.axis}
        direction={1}
        value={() => props.split.ratio}
        // 比率を動かすために、split自身の寸法を1単位あたりのpxとして渡す
        scale={() => (props.split.axis === "x" ? element.offsetWidth : element.offsetHeight)}
        apply={(next) => ops.ratio(props.split.id, next)}
      />
      <NodeView node={props.split.second} />
    </div>
  );
}
