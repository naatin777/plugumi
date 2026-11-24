// Style Lab（/lab）。TokenとComponentの見本と、work面の形を
// 変数から確かめるデモ。デモは本物と同じWorkShapeのCSSを使う。
// Tokenは色だけでなく、大きさ・太字・余白・角丸を実際の見た目で出す。
import { For, Show, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { WorkShape } from "../shell/work-shape.tsx";
import { tokenNames } from "@plugumi/plugin-view";
import styles from "./lab.module.css";
import stripStyles from "../shell/tab-strip.module.css";
import controlStyles from "../shell/controls.module.css";
import activityStyles from "../shell/activity.module.css";
import sidebarStyles from "../shell/sidebar.module.css";

const tones = ["neutral", "info", "success", "warning", "danger"] as const;
const effects = ["static", "flow", "glow"] as const;
const surfaces = ["header", "border", "divider", "content"] as const;

export default function LabPage(): JSX.Element {
  return (
    <div class={styles["lab"]}>
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
          <div class={styles["lab-tokens"]}>
            <h3>{group}</h3>
            <For each={Object.entries(names)}>
              {([name, css]) => (
                <div class={styles["lab-token"]}>
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
                                class={styles["lab-swatch"]}
                                style={{ "border-radius": css(), "background-color": "var(--plugumi-colors-background-tertiary)" }}
                                title={props.name}
                              />
                            </Show>
                          }
                        >
                          <span class={styles["lab-bar"]} style={{ width: css() }} title={props.name} />
                        </Show>
                      }
                    >
                      <p class={styles["lab-lineheight"]} style={{ "line-height": css() }}>
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
      <span class={styles["lab-swatch"]} style={{ background: css() }} title={props.name} />
    </Show>
  );
}

function Components(): JSX.Element {
  return (
    <section>
      <h2>Component</h2>
      <div class={stripStyles["tab-strip"]}>
        <div class={stripStyles["tab"]}><span class={stripStyles["tab-title"]}>tab</span></div>
        <div class={{ [stripStyles["tab"]]: true, [stripStyles["selected"]]: true }}><span class={stripStyles["tab-title"]}>selected</span></div>
        <div class={stripStyles["tab"]}><span class={stripStyles["tab-title"]}>もう1つ</span></div>
        <button class={sidebarStyles["project-add"]}>+</button>
      </div>
      <div class={styles["lab-row"]}>
        <button class={controlStyles["icon-button"]}>？</button>
        <button class={controlStyles["icon-button"]} aria-pressed="true">●</button>
        <button class={controlStyles["core-button"]}><span class={controlStyles["status-dot"]} data-status="connected" />local</button>
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
          <div class={styles["lab-row"]}>
            <For each={tones}>
              {(tone) => (
                <For each={effects}>
                  {(effect) => (
                    <div
                      class={styles["lab-activity"]}
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
      <div class={styles["lab-row"]}>
        <div class={styles["lab-progress-frame"]}>
          <div class={activityStyles["activity-progress"]} data-kind="determinate" style={{ width: "60%" }} />
          <span>determinate 60%</span>
        </div>
        <div class={styles["lab-progress-frame"]}>
          <div class={activityStyles["activity-progress"]} data-kind="indeterminate" />
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
      <div class={styles["lab-sliders"]}>
        <Slider label="sidebar幅" value={side} set={setSide} max={400} />
        <Slider label="左tool幅" value={toolsLeft} set={setToolsLeft} max={500} />
        <Slider label="右tool幅" value={toolsRight} set={setToolsRight} max={500} />
        <Slider label="OS領域のX" value={osX} set={setOsX} max={600} />
        <Slider label="OS領域の幅" value={osWidth} set={setOsWidth} max={1000} />
      </div>
      <div
        class={styles["lab-shape"]}
        data-part="lab-shape"
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
          titleLeft={<span class={styles["lab-fill"]}>左tool</span>}
          titleMain={<span class={styles["lab-fill"]}>work区間</span>}
          titleRight={<span class={styles["lab-fill"]}>右tool</span>}
          sidebar={<div class={styles["lab-fill"]}>sidebar</div>}
        >
          <div class={`${styles["lab-fill"]} ${styles["lab-mat"]}`} style={{ "grid-area": "left" }}>left</div>
          <div class={`${styles["lab-fill"]} ${styles["lab-mat"]}`} style={{ "grid-area": "center" }}>center</div>
          <div class={`${styles["lab-fill"]} ${styles["lab-mat"]}`} style={{ "grid-area": "right" }}>right</div>
          <div class={`${styles["lab-fill"]} ${styles["lab-mat"]}`} style={{ "grid-area": "bottom" }}>bottom</div>
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
    <label class={styles["lab-slider"]}>
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
