// Style Lab本体。tokenはcontract object（@plugumi/viewのtokens）を
// runtimeに走査して一覧を作る — 契約に追加されれば自動で並ぶので、
// カタログが契約からずれることがない。色はliveのvar()参照で描くので、
// テーマ切替にそのまま追従する。
import { For } from "solid-js";
import { render, type JSX } from "@solidjs/web";
import { tokens, type ViewContext, type ViewHandle } from "@plugumi/view";

// camelCaseの先頭セグメントで分類する: colorsAccent → colors
const groupOf = (key: string) => key.match(/^([a-z]+?)(?=[A-Z])/)?.[1] ?? key;
const entries = Object.entries(tokens) as [string, string][];
const groups = new Map<string, [string, string][]>();
for (const entry of entries) {
  const group = groupOf(entry[0]);
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group)!.push(entry);
}
const colorGroups = () => groups.get("colors") ?? [];
const spacingOf = (name: string) => groups.get(name) ?? [];

function Swatches(): JSX.Element {
  return (
    <div class="lab-swatches">
      <For each={colorGroups()}>
        {([key, cssVar]) => (
          <div class="lab-swatch" title={cssVar}>
            <div class="lab-chip" style={{ background: `var(${cssVar})` }} />
            <div class="lab-swatch-name">{key}</div>
          </div>
        )}
      </For>
    </div>
  );
}

function Scale(props: { title: string; name: string; sample: (cssVar: string) => JSX.Element }): JSX.Element {
  return (
    <section class="lab-section">
      <h3>{props.title}</h3>
      <For each={spacingOf(props.name)}>
        {([key, cssVar]) => (
          <div class="lab-row">
            <span class="lab-key">{key}</span>
            {props.sample(cssVar)}
          </div>
        )}
      </For>
    </section>
  );
}

function Lab(): JSX.Element {
  return (
    <div class="lab">
      <h2>Components</h2>
      <section class="lab-section">
        <h3>button</h3>
        <div class="lab-row">
          <button class="plugumi-button">default</button>
          <button class="plugumi-button plugumi-button--accent">accent</button>
          <button class="plugumi-button plugumi-button--danger">danger</button>
          <button class="plugumi-button" disabled>disabled</button>
        </div>
        <h3>input</h3>
        <div class="lab-row">
          <input class="plugumi-input" placeholder="placeholder" />
          <input class="plugumi-input" placeholder="disabled" disabled />
        </div>
        <h3>scrollbar</h3>
        <div class="lab-scrollbox">
          <div class="lab-scrollcontent" />
        </div>
      </section>
      <h2>Colors</h2>
      <Swatches />
      <Scale title="Spacing" name="spacing" sample={(v) => (
        <span class="lab-bar" style={{ width: `var(${v})` }} />
      )} />
      <Scale title="Radii" name="radii" sample={(v) => (
        <span class="lab-radiusbox" style={{ "border-radius": `var(${v})` }} />
      )} />
      <Scale title="Font size" name="fontSize" sample={(v) => (
        <span style={{ "font-size": `var(${v})` }}>あいうえお ABCabc 123</span>
      )} />
    </div>
  );
}

export function mount(host: ShadowRoot, _context: ViewContext): ViewHandle {
  const dispose = render(() => <Lab />, host);
  return { destroy: () => dispose() };
}
