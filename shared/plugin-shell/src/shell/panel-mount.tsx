// Panel InstanceのhostをDOMへ据える共用部品。dock・leaf・widgetのどれも
// 同じ「Panelの中身」を抱くが、Panelそのものは領域に依存しないので
// ここに置く。activityのborder/dividerはカードとstripが受け持つ
// （contentは列やbody側）。
import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { PanelInstance } from "../panels/instance.ts";
import { useShell } from "./controller.tsx";

export function PanelMount(props: { instance: PanelInstance }): JSX.Element {
  const host = props.instance.host;
  return (
    <div class="panel-frame">
      <ActivityProgress instance={props.instance} />
      <PanelState instance={props.instance} />
      {host}
    </div>
  );
}

// determinate/indeterminateの進捗。header/divider面の位置に細い帯で出す。
// widgetのmount枠でも同じ帯を使うのでexportする。
export function ActivityProgress(props: { instance: PanelInstance }): JSX.Element {
  const progress = () => props.instance.activity()?.progress;
  return (
    <Show when={progress()}>
      {(value) => (
        <div
          class="activity-progress"
          data-kind={value().kind}
          style={value().kind === "determinate"
            ? { width: `${Math.min(100, Math.max(0, (value() as { kind: "determinate"; value: number }).value * 100))}%` }
            : undefined}
        />
      )}
    </Show>
  );
}

// mounting/missing/errorの表示。hostは常に残し、tab切替ではDOMを壊さない。
export function PanelState(props: { instance: PanelInstance }): JSX.Element {
  const shell = useShell();
  return (
    <Show when={props.instance.state() !== "mounted" || props.instance.error()}>
      <div class="panel-state">
        <Show when={props.instance.error()}>
          {(error) => (
            <>
              <p>Panelを開けませんでした（{error().kind}）</p>
              <button onClick={() => props.instance.retry(shell.panels() ?? [])}>
                再試行
              </button>
            </>
          )}
        </Show>
        <Show when={!props.instance.error() && props.instance.state() === "missing"}>
          <p>このPanelを提供するPluginが見つかりません</p>
        </Show>
        <Show when={!props.instance.error() && props.instance.state() === "mounting"}>
          <p>読み込み中…</p>
        </Show>
      </div>
    </Show>
  );
}
