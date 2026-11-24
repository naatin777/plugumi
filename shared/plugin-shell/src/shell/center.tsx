// workspace中央のsplit木。axisに沿ってfirst/secondを並べ、間の溝で
// ratioを変える。空の領域は「+」でPanelを足す。
import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { Node, Split } from "../layout/model.ts";
import { useArea, layoutOps } from "./controller.tsx";
import { LeafView } from "./leaf.tsx";
import { Resizer } from "./resizer.tsx";
import styles from "./center.module.css";

// leafの各辺がregionの外縁に接するか。splitの内側の辺は直角にして
// 分割溝を真っ直ぐに通し、外縁だけ丸い1枚のカードに見せる
// （Googleのlist viewのsegment方式）。
export interface Edges { top: boolean; right: boolean; bottom: boolean; left: boolean }
const OUTER_EDGES: Edges = { top: true, right: true, bottom: true, left: true };

export function CenterView(): JSX.Element {
  const area = useArea();
  const root = () => area.layout().center.root;
  return (
    <div class={styles["center"]} data-region="center">
      <NodeView node={root()} edges={OUTER_EDGES} />
    </div>
  );
}

export function NodeView(props: { node: Node; edges: Edges }): JSX.Element {
  const leaf = () => (props.node.kind === "leaf" ? props.node : undefined);
  const split = () => (props.node.kind === "split" ? props.node : undefined);
  return (
    <Show when={split()} fallback={<Show when={leaf()}>{(node) => <LeafView leaf={node()} edges={props.edges} />}</Show>}>
      {(node) => <SplitView split={node()} edges={props.edges} />}
    </Show>
  );
}

function SplitView(props: { split: Split; edges: Edges }): JSX.Element {
  const ops = layoutOps(useArea());
  let element!: HTMLDivElement;
  const firstEdges = () => (props.split.axis === "x"
    ? { ...props.edges, right: false }
    : { ...props.edges, bottom: false });
  const secondEdges = () => (props.split.axis === "x"
    ? { ...props.edges, left: false }
    : { ...props.edges, top: false });
  return (
    <div
      ref={element}
      class={styles["split"]}
      data-axis={props.split.axis}
      style={props.split.axis === "x"
        ? { "grid-template-columns": `${props.split.ratio}fr var(--area-gap) ${1 - props.split.ratio}fr` }
        : { "grid-template-rows": `${props.split.ratio}fr var(--area-gap) ${1 - props.split.ratio}fr` }}
    >
      <NodeView node={props.split.first} edges={firstEdges()} />
      <Resizer
        axis={props.split.axis}
        direction={1}
        value={() => props.split.ratio}
        // 比率を動かすために、split自身の寸法を1単位あたりのpxとして渡す
        scale={() => (props.split.axis === "x" ? element.offsetWidth : element.offsetHeight)}
        apply={(next) => ops.ratio(props.split.id, next)}
      />
      <NodeView node={props.split.second} edges={secondEdges()} />
    </div>
  );
}
