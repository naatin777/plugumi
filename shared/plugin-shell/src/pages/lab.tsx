// /lab — Style Lab。Design TokenとShell部品の実見た目を1画面に並べる検証面。
// 契約の正本ではない（tokenの正本は styles/tokens.css、部品は index.css の実装）。
import { A } from "@solidjs/router";
import { ChevronDown, Plus, X } from "lucide-solid";
import { createSignal, For, onCleanup, onMount } from "solid-js";
import { tokenNames } from "@plugumi/plugin-view";
import { ThemeSwitch } from "../top-bar";

// テーマが切り替わるたびにgetComputedStyleを読み直す。
function useResolved(): (name: string) => string {
  const [tick, setTick] = createSignal(0);
  onMount(() => {
    const bump = () => setTick(tick() + 1);
    window.addEventListener("plugumi:theme", bump);
    onCleanup(() => window.removeEventListener("plugumi:theme", bump));
  });
  return (name: string) => {
    tick();
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  };
}

const sections = [
  { id: "colors", title: "Colors" },
  { id: "typography", title: "Typography" },
  { id: "spacing-radius", title: "Spacing・Radius" },
  { id: "shell-parts", title: "Shell parts" },
] as const;

export default function LabPage() {
  const resolved = useResolved();
  const jump = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <main class="lab">
      <aside class="lab-nav">
        <A href="/" class="lab-back">← Plugumi</A>
        <For each={sections}>
          {(section) => (
            <button onClick={() => jump(section.id)}>{section.title}</button>
          )}
        </For>
        <span class="lab-nav-spacer" />
        <ThemeSwitch />
      </aside>
      <div class="lab-content">
        <h1>Style Lab</h1>
        <Colors resolved={resolved} />
        <Typography resolved={resolved} />
        <SpacingRadius resolved={resolved} />
        <ShellParts />
      </div>
    </main>
  );
}

// token名・現在の解決値・スウォッチを並べる。一覧はtokenNamesから自動生成する。
function Colors(props: { resolved: (name: string) => string }) {
  return (
    <section id="colors" class="lab-section">
      <h2>Colors</h2>
      <div class="lab-grid">
        <For each={Object.entries(tokenNames.colors)}>
          {([key, name]) => (
            <div class="lab-token">
              <span class="lab-swatch" style={{ background: `var(${name})` }} />
              <div class="lab-meta">
                <code>{key}</code>
                <span class="lab-name">{name}</span>
                <span class="lab-value">{props.resolved(name)}</span>
              </div>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

const specimen = "あのイーハトーヴォのすきとおった風 The quick brown fox 0123456789";

function Typography(props: { resolved: (name: string) => string }) {
  return (
    <section id="typography" class="lab-section">
      <h2>Typography</h2>
      <h3>Family</h3>
      <div class="lab-rows">
        <For each={Object.entries(tokenNames.fontFamily)}>
          {([key, name]) => (
            <div class="lab-row">
              <code class="lab-key">{key}</code>
              <p style={{ "font-family": `var(${name})` }}>{specimen}</p>
              <span class="lab-value">{props.resolved(name)}</span>
            </div>
          )}
        </For>
      </div>
      <h3>Size</h3>
      <div class="lab-rows">
        <For each={Object.entries(tokenNames.fontSize)}>
          {([key, name]) => (
            <div class="lab-row">
              <code class="lab-key">{key}</code>
              <p style={{ "font-size": `var(${name})` }}>{specimen}</p>
              <span class="lab-value">{props.resolved(name)}</span>
            </div>
          )}
        </For>
      </div>
      <h3>Weight</h3>
      <div class="lab-rows">
        <For each={Object.entries(tokenNames.fontWeight)}>
          {([key, name]) => (
            <div class="lab-row">
              <code class="lab-key">{key}</code>
              <p style={{ "font-weight": `var(${name})` }}>{specimen}</p>
              <span class="lab-value">{props.resolved(name)}</span>
            </div>
          )}
        </For>
      </div>
      <h3>Letter spacing</h3>
      <div class="lab-rows">
        <For each={Object.entries(tokenNames.letterSpacing)}>
          {([key, name]) => (
            <div class="lab-row">
              <code class="lab-key">{key}</code>
              <p style={{ "letter-spacing": `var(${name})` }}>{specimen}</p>
              <span class="lab-value">{props.resolved(name)}</span>
            </div>
          )}
        </For>
      </div>
      <h3>Line height</h3>
      <div class="lab-rows">
        <For each={Object.entries(tokenNames.lineHeight)}>
          {([key, name]) => (
            <div class="lab-row">
              <code class="lab-key">{key}</code>
              <p style={{ "line-height": `var(${name})` }}>{specimen} {specimen}</p>
              <span class="lab-value">{props.resolved(name)}</span>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

function SpacingRadius(props: { resolved: (name: string) => string }) {
  return (
    <section id="spacing-radius" class="lab-section">
      <h2>Spacing</h2>
      <div class="lab-rows">
        <For each={Object.entries(tokenNames.spacing)}>
          {([key, name]) => (
            <div class="lab-row">
              <code class="lab-key">{key}</code>
              <span class="lab-bar" style={{ width: `var(${name})` }} />
              <span class="lab-value">{props.resolved(name)}</span>
            </div>
          )}
        </For>
      </div>
      <h2>Radius</h2>
      <div class="lab-rows">
        <For each={Object.entries(tokenNames.radii)}>
          {([key, name]) => (
            <div class="lab-row">
              <code class="lab-key">{key}</code>
              <span class="lab-box" style={{ "border-radius": `var(${name})` }} />
              <span class="lab-value">{props.resolved(name)}</span>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

// index.cssの実装クラスをそのまま並べる。見た目を変えるときここで比較する。
function ShellParts() {
  return (
    <section id="shell-parts" class="lab-section">
      <h2>Shell parts</h2>

      <h3>Top bar — shell-tool</h3>
      <div class="lab-inline">
        <button class="shell-tool">通常</button>
        <button class="shell-tool" disabled>disabled</button>
      </div>

      <h3>Core switcher — shell-core-item / dot</h3>
      <div class="lab-framed">
        <button class="shell-core-item"><span class="dot ok" /><span class="name">local</span><span class="status">connected</span></button>
        <button class="shell-core-item active"><span class="dot warn" /><span class="name">dev</span><span class="status">connecting</span></button>
        <button class="shell-core-item"><span class="dot err" /><span class="name">broken</span><span class="status">rejected</span></button>
        <button class="shell-core-item"><span class="dot off" /><span class="name">away</span><span class="status">unreachable</span></button>
        <div class="menu-sep" />
        <button class="shell-core-item">Coreの管理</button>
      </div>

      <h3>Tab — shell-tab / shell-add（Project札・Panel札で共通）</h3>
      <div class="lab-inline">
        <span class="shell-tab"><a>plugumi</a><span class="close">×</span></span>
        <span class="shell-tab active"><a>work</a><span class="close">×</span></span>
        <button class="shell-tab">Files<span class="close">×</span></button>
        <button class="shell-tab active">Terminal<span class="close">×</span></button>
        <button class="shell-add">+</button>
      </div>

      <h3>Dock picker</h3>
      <div class="lab-framed">
        <div class="dock-picker">
          <button>Files <span class="meta">standard/files</span></button>
          <button>Terminal <span class="meta">agent/terminal</span></button>
          <p class="meta">Panelはありません</p>
        </div>
      </div>

      <h3>Area tree（行の操作はhoverで表示）</h3>
      <div class="lab-framed">
        <ul class="area-tree">
          <li>
            <div class="area-row"><button class="area-tw"><ChevronDown size={12} /></button><a>main</a><button class="area-op"><Plus size={12} /></button><button class="area-op"><X size={12} /></button></div>
            <ul>
              <li><div class="area-row active"><span class="area-tw" /><a>src</a><button class="area-op"><Plus size={12} /></button><button class="area-op"><X size={12} /></button></div></li>
            </ul>
          </li>
          <li><div class="area-row"><span class="area-tw" /><a>aaa</a><button class="area-op"><Plus size={12} /></button><button class="area-op"><X size={12} /></button></div></li>
        </ul>
        <button class="area-add"><Plus size={12} /> Area</button>
      </div>

      <h3>Text / feedback</h3>
      <div class="lab-inline">
        <p class="placeholder">placeholder</p>
        <p class="error">error</p>
        <p class="panel-message"><span class="kind">mount-error</span></p>
      </div>
      <div class="lab-inline">
        <span class="status-connected">connected</span>
        <span class="status-connecting">connecting</span>
        <span class="status-rejected">rejected</span>
        <span class="status-unreachable">unreachable</span>
      </div>

      <h3>Base elements</h3>
      <h1>見出し h1</h1>
      <h2>見出し h2</h2>
      <div class="lab-inline">
        <a href="#" onClick={(e) => e.preventDefault()}>リンク</a>
        <button>button</button>
        <input type="text" value="input value" readOnly />
      </div>
      <table>
        <thead><tr><th>Name</th><th>状態</th></tr></thead>
        <tbody><tr><td>local</td><td>connected</td></tr></tbody>
      </table>
    </section>
  );
}
