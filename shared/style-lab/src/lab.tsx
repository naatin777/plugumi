// Style Lab本体。tokenはcontract object（@plugumi/viewのtokens）を
// runtimeに走査して一覧を作る — 契約に追加されれば自動で並ぶので、
// カタログが契約からずれることがない。色はliveのvar()参照で描くので、
// テーマ切替にそのまま追従する。
import { For, createSignal } from "solid-js";
import { render, type JSX } from "@solidjs/web";
import { tokens, type ViewContext, type ViewHandle } from "@plugumi/view";
import { usedTokens } from "./usage.ts";

// カテゴリはkeyのprefixで判定する。fontSizeはfont+Size+Smと分解不能な
// camelCaseなのでregex groupingは不可能 — 明示prefixのstartsWithで
// 選ぶ。既存カテゴリへの追加は自動で並び、新カテゴリは見せ方の設計を
// 伴うのでsection追加を要する、という線引き。
const entries = Object.entries(tokens) as [string, string][];
const prefixed = (prefix: string) => entries.filter(([key]) => key.startsWith(prefix));
const colorGroups = () => prefixed("colors");

function Swatches(): JSX.Element {
  return (
    <div class="lab-swatches">
      <For each={colorGroups()}>
        {([key, cssVar]) => (
          <div class={{ "lab-swatch": true, unused: !usedTokens.has(key) }} title={cssVar}>
            <div class="lab-chip" style={{ background: `var(${cssVar})` }} />
            <div class="lab-swatch-name">{key}</div>
          </div>
        )}
      </For>
    </div>
  );
}

function Scale(props: { title: string; prefix: string; sample: (cssVar: string) => JSX.Element }): JSX.Element {
  return (
    <section class="lab-section">
      <h3>{props.title}</h3>
      <For each={prefixed(props.prefix)}>
        {([key, cssVar]) => (
          <div class={{ "lab-row": true, unused: !usedTokens.has(key) }}>
            <span class="lab-key">{key}</span>
            {props.sample(cssVar)}
          </div>
        )}
      </For>
    </section>
  );
}

// typographyはfamily/size/weight/height/letterSpacingを横断した
// specimenとして1つにまとめて見せる。個別scaleより文章で見た方が
// 組み合わせの確認になる。
function Typography(): JSX.Element {
  return (
    <section class="lab-section">
      <h3>font family</h3>
      <For each={prefixed("fontFamily")}>
        {([key, cssVar]) => (
          <div class="lab-row">
            <span class="lab-key">{key}</span>
            <span style={{ "font-family": `var(${cssVar})` }}>あいうえお ABCabc 123</span>
          </div>
        )}
      </For>
      <h3>font weight</h3>
      <For each={prefixed("fontWeight")}>
        {([key, cssVar]) => (
          <div class="lab-row">
            <span class="lab-key">{key}</span>
            <span style={{ "font-weight": `var(${cssVar})` }}>あいうえお ABCabc 123</span>
          </div>
        )}
      </For>
    </section>
  );
}

// sectionの定義。menuに並ぶ順 = ここに並ぶ順。新しいカテゴリは
// ここに足す — 追加するとnavにも自動で出る。
const SECTIONS: { id: string; title: string; render: () => JSX.Element }[] = [
  {
    id: "chrome", title: "Chrome",
    render: () => (
      <section class="lab-section">
        <h3>icon-button — 26×26、radius md、borderなし</h3>
        <div class="lab-row">
          <span class="lab-key">off</span>
          <button class="icon-button" aria-label="off example">
            <svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
          </button>
          <span class="lab-key">on (aria-pressed)</span>
          <button class="icon-button" aria-label="on example" aria-pressed="true">
            <svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
          </button>
          <span class="lab-note">hoverは実際に触って確認 — transparent→background-tertiary</span>
        </div>
        <h3>tab — radius sm、輪郭はinset shadow（raised-edge 35%）</h3>
        <div class="tab-strip" style={{ border: "none", padding: 0 }}>
          <button class="tab">
            <span class="tab-title">非選択</span>
          </button>
          <button class="tab selected">
            <span class="tab-title">選択中</span>
            <span class="tab-close">×</span>
          </button>
        </div>
        <h3>picker item — menuの1行</h3>
        <div class="lab-row">
          <div class="panel-picker" style={{ position: "static", border: "none" }}>
            <button class="picker-item">
              <span>Files</span>
              <span class="picker-plugin">shell</span>
            </button>
          </div>
        </div>
      </section>
    ),
  },
  {
    id: "components", title: "Components",
    render: () => (
      <section class="lab-section">
        <h3>button</h3>
        <div class="lab-row">
          <button class="plugumi-button">default</button>
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
    ),
  },
  { id: "colors", title: "Colors", render: () => <Swatches /> },
  {
    id: "typography", title: "Typography",
    render: () => (
      <>
        <Typography />
        <Scale title="Font size" prefix="fontSize" sample={(v) => (
          <span style={{ "font-size": `var(${v})` }}>あいうえお ABCabc 123</span>
        )} />
      </>
    ),
  },
  {
    id: "scales", title: "Scales",
    render: () => (
      <>
        <Scale title="Spacing" prefix="spacing" sample={(v) => (
          <span class="lab-bar" style={{ width: `var(${v})` }} />
        )} />
        <Scale title="Radii" prefix="radii" sample={(v) => (
          <span class="lab-radiusbox" style={{ "border-radius": `var(${v})` }} />
        )} />
      </>
    ),
  },
];

function Lab(): JSX.Element {
  const [active, setActive] = createSignal(SECTIONS[0].id);
  const current = () => SECTIONS.find((section) => section.id === active()) ?? SECTIONS[0];
  return (
    <div class="lab">
      <nav class="lab-nav">
        <For each={SECTIONS}>
          {(section) => (
            <button
              class={{ "lab-nav-item": true, selected: active() === section.id }}
              onClick={() => setActive(section.id)}
            >
              {section.title}
            </button>
          )}
        </For>
      </nav>
      <div class="lab-content">
        <div class="lab-summary">{usedTokens.size} / {entries.length} tokens in use — 薄いものは未使用</div>
        <h2>{current().title}</h2>
        {current().render()}
      </div>
    </div>
  );
}

export function mount(host: ShadowRoot, _context: ViewContext): ViewHandle {
  const dispose = render(() => <Lab />, host);
  return { destroy: () => dispose() };
}
