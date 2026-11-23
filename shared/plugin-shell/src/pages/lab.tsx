// Style Lab（/lab）。TokenとComponentの見本と、work面の形を
// 変数から確かめるデモ。デモは本物と同じWorkShapeのCSSを使う。
// Tokenは色だけでなく、大きさ・太字・余白・角丸を実際の見た目で出す。
import { For, Show, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { WorkShape } from "../shell/work-shape.tsx";
import { tokenNames } from "@plugumi/plugin-view";

const tones = ["neutral", "info", "success", "warning", "danger"] as const;
const effects = ["static", "flow", "glow"] as const;
const surfaces = ["header", "border", "divider", "content"] as const;

export default function LabPage(): JSX.Element {
  return (
    <div class="lab">
      <h1>Style Lab</h1>
      <Tokens />
      <Components />
      <ActivitySamples />
      <ShapeDemo />
    </div>
  );
}

// tokenカテゴリごとに見せ方を変える。全部色見本にすると
// font-sizeやspacingが何も分からない。
function Tokens(): JSX.Element {
  const groups = Object.entries(tokenNames) as [string, Record<string, string>][];
  return (
    <section>
      <h2>Token</h2>
      <For each={groups}>
        {([group, names]) => (
          <div class="lab-tokens">
            <h3>{group}</h3>
            <For each={Object.entries(names)}>
              {([name, css]) => (
                <div class="lab-token">
                  <code>{name}</code>
                  <TokenSample group={group} name={css} />
                </div>
              )}
            </For>
          </div>
        )}
      </For>
    </section>
  );
}

function TokenSample(props: { group: string; name: string }): JSX.Element {
  const css = () => `var(${props.name})`;
  return (
    <Show
      when={props.group === "colors"}
      fallback={
        <Show
          when={props.group === "fontSize"}
          fallback={
            <Show
              when={props.group === "fontWeight"}
              fallback={
                <Show
                  when={props.group === "letterSpacing"}
                  fallback={
                    <Show
                      when={props.group === "lineHeight"}
                      fallback={
                        <Show
                          when={props.group === "spacing"}
                          fallback={
                            <Show
                              when={props.group === "radii"}
                              fallback={<span style={{ "font-family": css() }}>Aa あア</span>}
                            >
                              <span
                                class="lab-swatch"
                                style={{ "border-radius": css(), "background-color": "var(--plugumi-colors-background-tertiary)" }}
                                title={props.name}
                              />
                            </Show>
                          }
                        >
                          <span class="lab-bar" style={{ width: css() }} title={props.name} />
                        </Show>
                      }
                    >
                      <p class="lab-lineheight" style={{ "line-height": css() }}>
                        行の高さの見本。<br />2行目の位置で確かめる。
                      </p>
                    </Show>
                  }
                >
                  <span style={{ "letter-spacing": css() }}>字間の見本</span>
                </Show>
              }
            >
              <span style={{ "font-weight": css() }}>太さの見本 あア</span>
            </Show>
          }
        >
          <span style={{ "font-size": css() }}>文字の大きさ</span>
        </Show>
      }
    >
      <span class="lab-swatch" style={{ background: css() }} title={props.name} />
    </Show>
  );
}

function Components(): JSX.Element {
  return (
    <section>
      <h2>Component</h2>
      <div class="tab-strip">
        <div class="tab"><span class="tab-title">tab</span></div>
        <div class={{ tab: true, selected: true }}><span class="tab-title">selected</span></div>
        <div class="tab"><span class="tab-title">もう1つ</span></div>
        <button class="project-add">+</button>
      </div>
      <div class="lab-row">
        <button class="icon-button">？</button>
        <button class="icon-button" aria-pressed="true">●</button>
        <button class="core-button"><span class="status-dot" data-status="connected" />local</button>
      </div>
    </section>
  );
}

function ActivitySamples(): JSX.Element {
  return (
    <section>
      <h2>Activity</h2>
      <For each={surfaces}>
        {(surface) => (
          <div class="lab-row">
            <For each={tones}>
              {(tone) => (
                <For each={effects}>
                  {(effect) => (
                    <div
                      class="lab-activity"
                      {...{ [`data-activity-${surface}`]: `${tone} ${effect}` }}
                    >
                      {surface}/{tone}/{effect}
                    </div>
                  )}
                </For>
              )}
            </For>
          </div>
        )}
      </For>
      <div class="lab-row">
        <div class="lab-progress-frame">
          <div class="activity-progress" data-kind="determinate" style={{ width: "60%" }} />
          <span>determinate 60%</span>
        </div>
        <div class="lab-progress-frame">
          <div class="activity-progress" data-kind="indeterminate" />
          <span>indeterminate</span>
        </div>
      </div>
    </section>
  );
}

// work面の形のデモ。本物と同じ変数をスライダーで動かす。
function ShapeDemo(): JSX.Element {
  const [side, setSide] = createSignal(260);
  const [toolsLeft, setToolsLeft] = createSignal(260);
  const [toolsRight, setToolsRight] = createSignal(280);
  const [osX, setOsX] = createSignal(80);
  const [osWidth, setOsWidth] = createSignal(120);
  return (
    <section>
      <h2>work面の形</h2>
      <div class="lab-sliders">
        <Slider label="sidebar幅" value={side} set={setSide} max={400} />
        <Slider label="左tool幅" value={toolsLeft} set={setToolsLeft} max={500} />
        <Slider label="右tool幅" value={toolsRight} set={setToolsRight} max={500} />
        <Slider label="OS領域のX" value={osX} set={setOsX} max={600} />
        <Slider label="OS領域の幅" value={osWidth} set={setOsWidth} max={1000} />
      </div>
      <div
        class="lab-shape"
        style={{
          "--shell-viewport": "100%",
          "--side-width": `${side()}px`,
          "--title-tools-left": `${toolsLeft()}px`,
          "--title-tools-right": `${toolsRight()}px`,
          "--os-inset-x": `${osX()}px`,
          "--os-inset-width": `${osWidth()}px`,
          "--os-inset-height": "40px",
        }}
      >
        <WorkShape
          titleLeft={<span class="lab-fill">左tool</span>}
          titleCenter={<span class="lab-fill">work区間</span>}
          titleRight={<span class="lab-fill">右tool</span>}
          sidebar={<div class="lab-fill">sidebar</div>}
        >
          <div class="lab-fill lab-mat" style={{ "grid-area": "left" }}>left</div>
          <div class="lab-fill lab-mat" style={{ "grid-area": "center" }}>center</div>
          <div class="lab-fill lab-mat" style={{ "grid-area": "side" }}>side</div>
          <div class="lab-fill lab-mat" style={{ "grid-area": "bottom" }}>bottom</div>
        </WorkShape>
      </div>
    </section>
  );
}

function Slider(props: {
  label: string;
  value: () => number;
  set: (v: number) => void;
  max: number;
}): JSX.Element {
  return (
    <label class="lab-slider">
      {props.label}
      <input
        type="range" min={0} max={props.max}
        value={props.value()}
        onInput={(event) => props.set(Number(event.currentTarget.value))}
      />
      <code>{props.value()}px</code>
    </label>
  );
}
